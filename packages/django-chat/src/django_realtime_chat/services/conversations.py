"""Conversation and membership use cases."""

from __future__ import annotations

import base64
import uuid
from datetime import datetime
from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from .. import events, signals
from ..conf import chat_settings
from ..errors import FeatureDisabled, NotFound, PermissionDenied, ValidationFailed
from ..models import Conversation, Membership
from ..permissions import get_policy
from ..serializers import conversation_payload, conversation_payloads, conversation_queryset_for
from ..users import clean_user_id

PAGE_SIZE = 50


def get_membership(user: Any, conversation_id: Any, *, for_update: bool = False) -> Membership:
    """Resolve an active membership or raise ``NotFound`` (never reveal private conversations)."""
    qs = Membership.objects.select_related("conversation")
    if for_update:
        # Without `of=`, PostgreSQL locks the joined conversation row too. Member changes
        # rely on that to serialize per conversation (see tests/test_concurrency.py).
        qs = qs.select_for_update()
    try:
        return qs.get(conversation_id=conversation_id, user=user, left_at__isnull=True)
    except (Membership.DoesNotExist, ValueError, TypeError, DjangoValidationError) as exc:
        # Malformed UUIDs raise ValidationError; treat them like unknown ids.
        raise NotFound("Conversation not found.") from exc


def active_conversation_ids(user: Any) -> list[str]:
    return [
        str(pk)
        for pk in Membership.objects.filter(user=user, left_at__isnull=True).values_list(
            "conversation_id", flat=True
        )
    ]


def list_conversations(
    user: Any,
    *,
    before: str | None = None,
    kind: str | None = None,
    query: str | None = None,
    limit: int = PAGE_SIZE,
) -> dict[str, Any]:
    qs = conversation_queryset_for(user).order_by("-last_activity_at", "-id")
    if kind:
        if kind not in Conversation.Kind.values:
            raise ValidationFailed("Unknown conversation kind.", code="invalid_kind")
        qs = qs.filter(kind=kind)
    if query:
        qs = qs.filter(
            Q(title__icontains=query)
            | Q(kind=Conversation.Kind.DIRECT, memberships__user__in=_user_matches(user, query))
        ).distinct()
    if before:
        try:
            stamp, _, cursor_id = base64.urlsafe_b64decode(before.encode() + b"==").decode().partition("|")
            moment = datetime.fromisoformat(stamp)
            uuid.UUID(cursor_id)
        except ValueError as exc:
            raise ValidationFailed("Invalid cursor.", code="invalid_cursor") from exc
        qs = qs.filter(Q(last_activity_at__lt=moment) | Q(last_activity_at=moment, id__lt=cursor_id))
    limit = max(1, min(limit, 100))
    rows = list(qs[: limit + 1])
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if has_more and rows:
        raw = f"{rows[-1].last_activity_at.isoformat()}|{rows[-1].pk}".encode()
        next_cursor = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    return {"results": conversation_payloads(rows, user), "has_more": has_more, "next_cursor": next_cursor}


def _user_matches(user: Any, query: str):
    from ..users import get_user_adapter

    return get_user_adapter().search(get_policy().user_queryset(user), query).values("pk")


def get_conversation(user: Any, conversation_id: Any) -> dict[str, Any]:
    membership = get_membership(user, conversation_id)
    return conversation_payload(membership.conversation, user)


def _resolve_users(user: Any, user_ids: Any) -> list[Any]:
    if not isinstance(user_ids, (list, tuple)) or any(isinstance(i, (dict, list)) for i in user_ids):
        raise ValidationFailed("member_ids must be a list of user ids.", code="invalid_members")
    cleaned = [clean_user_id(i) for i in user_ids]
    if any(c is None for c in cleaned):
        raise ValidationFailed("One or more users cannot be added.", code="invalid_members")
    wanted = {c for c in cleaned if str(c) != str(user.pk)}
    if not wanted:
        return []
    found = list(get_policy().user_queryset(user).filter(pk__in=list(wanted)))
    if len(found) != len(wanted):
        # Same error whether the user does not exist or is not discoverable.
        raise ValidationFailed("One or more users cannot be added.", code="invalid_members")
    return found


def start_direct(user: Any, other_user_id: Any) -> tuple[Conversation, bool]:
    others = _resolve_users(user, [other_user_id])
    if len(others) != 1:
        raise ValidationFailed("Choose another user for a direct conversation.", code="invalid_members")
    other = others[0]
    policy = get_policy()
    if not policy.can_start_direct(user, other):
        raise PermissionDenied("You cannot message this user.")
    low, high = sorted([str(user.pk), str(other.pk)], key=lambda v: (len(v), v))
    key = f"{low}:{high}"
    existing = Conversation.objects.filter(direct_key=key).first()
    if existing is not None:
        _reactivate(existing, [user, other])
        return existing, False
    try:
        with transaction.atomic():
            conv = Conversation.objects.create(kind=Conversation.Kind.DIRECT, direct_key=key, created_by=user)
            Membership.objects.bulk_create(
                [
                    Membership(conversation=conv, user=user, role=Membership.Role.MEMBER),
                    Membership(conversation=conv, user=other, role=Membership.Role.MEMBER),
                ]
            )
            _announce_new(conv, user, [user.pk, other.pk])
    except IntegrityError:
        # A concurrent request created the same direct conversation first.
        return Conversation.objects.get(direct_key=key), False
    return conv, True


def _reactivate(conv: Conversation, users: list[Any]) -> None:
    Membership.objects.filter(conversation=conv, user__in=users, left_at__isnull=False).update(left_at=None)


def create_group(user: Any, *, title: str, member_ids: Any, description: str = "") -> Conversation:
    policy = get_policy()
    if not chat_settings.ENABLE_GROUPS:
        raise FeatureDisabled("Group conversations are disabled.")
    if not policy.can_create_group(user):
        raise PermissionDenied("You cannot create groups.")
    title = _clean_title(title)
    description = _clean_description(description)
    members = _resolve_users(user, member_ids)
    if len(members) + 1 > chat_settings.MAX_GROUP_MEMBERS:
        raise ValidationFailed("Too many members.", code="too_many_members")
    with transaction.atomic():
        conv = Conversation.objects.create(
            kind=Conversation.Kind.GROUP, title=title, description=description, created_by=user
        )
        Membership.objects.bulk_create(
            [Membership(conversation=conv, user=user, role=Membership.Role.OWNER)]
            + [Membership(conversation=conv, user=m, role=Membership.Role.MEMBER) for m in members]
        )
        _announce_new(conv, user, [user.pk] + [m.pk for m in members])
    return conv


def _announce_new(conv: Conversation, actor: Any, user_ids: list[Any]) -> None:
    notify_conversation(conv, user_ids)
    transaction.on_commit(
        lambda: signals.conversation_created.send(sender=Conversation, conversation=conv, created_by=actor)
    )


def _clean_title(title: Any) -> str:
    title = str(title or "").strip()
    if not title:
        raise ValidationFailed("A group name is required.", code="invalid_title")
    if len(title) > chat_settings.MAX_TITLE_LENGTH:
        raise ValidationFailed("The group name is too long.", code="invalid_title")
    return title


def _clean_description(description: Any) -> str:
    description = str(description or "").strip()
    if len(description) > 500:
        raise ValidationFailed("The description is too long.", code="invalid_description")
    return description


def update_conversation(user: Any, conversation_id: Any, data: dict[str, Any]) -> Conversation:
    with transaction.atomic():
        membership = get_membership(user, conversation_id, for_update=True)
        conv = membership.conversation
        if not get_policy().can_edit_conversation(user, conv, membership):
            raise PermissionDenied("You cannot edit this conversation.")
        fields = []
        if "title" in data:
            conv.title = _clean_title(data["title"])
            fields.append("title")
        if "description" in data:
            conv.description = _clean_description(data["description"])
            fields.append("description")
        if fields:
            conv.save(update_fields=[*fields, "updated_at"])
            notify_conversation(conv, _member_ids(conv))
    return conv


def add_members(user: Any, conversation_id: Any, user_ids: Any) -> list[Any]:
    with transaction.atomic():
        membership = get_membership(user, conversation_id, for_update=True)
        conv = membership.conversation
        if not get_policy().can_add_members(user, conv, membership):
            raise PermissionDenied("You cannot add members to this conversation.")
        new_users = _resolve_users(user, user_ids)
        if not new_users:
            raise ValidationFailed("Choose at least one user.", code="invalid_members")
        existing = {
            m.user_id: m
            for m in Membership.objects.select_for_update().filter(conversation=conv, user__in=new_users)
        }
        active_count = Membership.objects.filter(conversation=conv, left_at__isnull=True).count()
        added = [u for u in new_users if u.pk not in existing or existing[u.pk].left_at is not None]
        if active_count + len(added) > chat_settings.MAX_GROUP_MEMBERS:
            raise ValidationFailed("Too many members.", code="too_many_members")
        now = timezone.now()
        for target in added:
            if target.pk in existing:
                m = existing[target.pk]
                m.left_at, m.role, m.joined_at = None, Membership.Role.MEMBER, now
                # Members who rejoin start reading from the current end of the conversation.
                m.last_read_seq = conv.last_seq
                m.save(update_fields=["left_at", "role", "joined_at", "last_read_seq"])
            else:
                Membership.objects.create(conversation=conv, user=target, joined_at=now)
        if added:
            notify_conversation(conv, _member_ids(conv))
            ids = [u.pk for u in added]
            transaction.on_commit(
                lambda: signals.members_changed.send(
                    sender=Conversation,
                    conversation=conv,
                    added_user_ids=ids,
                    removed_user_ids=[],
                    changed_by=user,
                )
            )
    return added


def remove_member(user: Any, conversation_id: Any, target_user_id: Any) -> None:
    with transaction.atomic():
        membership = get_membership(user, conversation_id, for_update=True)
        conv = membership.conversation
        try:
            target = Membership.objects.select_for_update().get(
                conversation=conv, user_id=_target_id(target_user_id), left_at__isnull=True
            )
        except (Membership.DoesNotExist, ValueError, DjangoValidationError) as exc:
            raise NotFound("Member not found.") from exc
        if not get_policy().can_remove_member(user, conv, membership, target):
            raise PermissionDenied("You cannot remove this member.")
        target.left_at = timezone.now()
        was_owner = target.role == Membership.Role.OWNER
        target.role = Membership.Role.MEMBER
        target.save(update_fields=["left_at", "role"])
        if was_owner:
            _transfer_ownership(conv)
        remaining = _member_ids(conv)
        notify_conversation(conv, remaining)
        events.to_users([target.user_id], "conversation.removed", {"conversation_id": str(conv.pk)})
        removed = [target.user_id]
        transaction.on_commit(
            lambda: signals.members_changed.send(
                sender=Conversation,
                conversation=conv,
                added_user_ids=[],
                removed_user_ids=removed,
                changed_by=user,
            )
        )


def _target_id(value: Any) -> Any:
    cleaned = clean_user_id(value)
    if cleaned is None:
        raise NotFound("Member not found.")
    return cleaned


def _transfer_ownership(conv: Conversation) -> None:
    """The longest-standing admin becomes owner, otherwise the longest-standing member."""
    active = Membership.objects.filter(conversation=conv, left_at__isnull=True).order_by("joined_at", "pk")
    successor = active.filter(role=Membership.Role.ADMIN).first() or active.first()
    if successor is not None:
        successor.role = Membership.Role.OWNER
        successor.save(update_fields=["role"])


def change_role(user: Any, conversation_id: Any, target_user_id: Any, role: Any) -> Membership:
    if role not in {Membership.Role.ADMIN, Membership.Role.MEMBER, Membership.Role.OWNER}:
        raise ValidationFailed("Unknown role.", code="invalid_role")
    with transaction.atomic():
        membership = get_membership(user, conversation_id, for_update=True)
        conv = membership.conversation
        try:
            target = Membership.objects.select_for_update().get(
                conversation=conv, user_id=_target_id(target_user_id), left_at__isnull=True
            )
        except (Membership.DoesNotExist, ValueError, DjangoValidationError) as exc:
            raise NotFound("Member not found.") from exc
        if not get_policy().can_change_role(user, conv, membership, target, role):
            raise PermissionDenied("You cannot change this member's role.")
        if role == Membership.Role.OWNER:
            membership.role = Membership.Role.ADMIN
            membership.save(update_fields=["role"])
        target.role = role
        target.save(update_fields=["role"])
        notify_conversation(conv, _member_ids(conv))
    return target


def mark_read(user: Any, conversation_id: Any, seq: Any) -> int:
    try:
        seq = int(seq)
    except (TypeError, ValueError) as exc:
        raise ValidationFailed("seq must be an integer.", code="invalid_seq") from exc
    membership = get_membership(user, conversation_id)
    seq = max(0, min(seq, membership.conversation.last_seq))
    # Monotonic: a stale or out-of-order read never moves the marker backwards.
    updated = Membership.objects.filter(pk=membership.pk, last_read_seq__lt=seq).update(last_read_seq=seq)
    if updated:
        events.to_conversation(
            membership.conversation_id, "read.updated", {"user_id": user.pk, "last_read_seq": seq}
        )
        return seq
    return max(seq, membership.last_read_seq)


def _member_ids(conv: Conversation) -> list[Any]:
    return list(
        Membership.objects.filter(conversation=conv, left_at__isnull=True).values_list("user_id", flat=True)
    )


def notify_conversation(conv: Conversation, user_ids: list[Any]) -> None:
    """Send each member a viewer-specific ``conversation.updated`` event after commit."""
    from django.contrib.auth import get_user_model

    def payload_for(uid: Any) -> dict[str, Any] | None:
        viewer = get_user_model()._default_manager.filter(pk=uid).first()
        if viewer is None:
            return None
        try:
            return {"conversation": conversation_payload(conv, viewer)}
        except Conversation.DoesNotExist:
            return None

    events.to_users(user_ids, "conversation.updated", payload_for)
