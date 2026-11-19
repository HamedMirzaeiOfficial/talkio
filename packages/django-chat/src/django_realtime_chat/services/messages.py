"""Message use cases: creation (idempotent, sequenced), history, edits, reactions."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta
from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.translation import gettext

from .. import events, signals
from ..conf import chat_settings
from ..emoji import is_emoji
from ..errors import FeatureDisabled, NotFound, PermissionDenied, ValidationFailed
from ..models import Attachment, Conversation, Membership, Message, Reaction, Sticker
from ..permissions import get_policy
from ..serializers import message_payload, message_queryset, reaction_summary
from .attachments import delete_attachment_files
from .conversations import get_membership
from .stickers import resolve_sticker

PAGE_SIZE = 50
MAX_PAGE_SIZE = 100
CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9_.:\-]{1,64}$")
# Bidi overrides/isolates can be abused to visually reorder text ("Trojan Source").
_BIDI_CONTROLS = re.compile("[‪-‮⁦-⁩]")


def normalize_body(body: Any) -> str:
    if body is None:
        return ""
    if not isinstance(body, str):
        raise ValidationFailed(gettext("body must be a string."), code="invalid_body")
    body = _BIDI_CONTROLS.sub("", body.replace("\r\n", "\n").replace("\x00", "")).strip()
    if len(body) > chat_settings.MAX_MESSAGE_LENGTH:
        raise ValidationFailed(
            gettext("Messages are limited to %(max_message_length)s characters.")
            % {"max_message_length": chat_settings.MAX_MESSAGE_LENGTH},
            code="message_too_long",
            details={"max_length": chat_settings.MAX_MESSAGE_LENGTH},
        )
    return body


def normalize_client_id(client_id: Any) -> str:
    if client_id in (None, ""):
        return uuid.uuid4().hex
    client_id = str(client_id)
    if not CLIENT_ID_RE.match(client_id):
        raise ValidationFailed(
            gettext("client_id must be 1-64 URL-safe characters."), code="invalid_client_id"
        )
    return client_id


def _get_message(user: Any, message_id: Any, *, for_update: bool = False) -> tuple[Message, Membership]:
    qs = Message.objects.select_related("conversation")
    if for_update:
        qs = qs.select_for_update(of=("self",))
    try:
        message = qs.get(pk=message_id)
    except (Message.DoesNotExist, ValueError, DjangoValidationError) as exc:
        raise NotFound(gettext("Message not found.")) from exc
    try:
        membership = get_membership(user, message.conversation_id)
    except NotFound as exc:
        raise NotFound(gettext("Message not found.")) from exc
    return message, membership


# --- creation -----------------------------------------------------------------------


def send_message(
    user: Any,
    conversation_id: Any,
    *,
    body: Any = "",
    client_id: Any = None,
    reply_to_id: Any = None,
    attachment_ids: Any = (),
    sticker_id: Any = None,
) -> tuple[Message, bool]:
    """Create a message. Returns ``(message, created)``; ``created`` is False for a retry."""
    membership = get_membership(user, conversation_id)
    return _create(
        user,
        membership,
        body=body,
        client_id=client_id,
        reply_to_id=reply_to_id,
        attachment_ids=attachment_ids,
        sticker=resolve_sticker(sticker_id) if sticker_id else None,
    )


def forward_message(
    user: Any, message_id: Any, target_conversation_id: Any, client_id: Any = None
) -> tuple[Message, bool]:
    source, _ = _get_message(user, message_id)
    if source.deleted_at:
        raise ValidationFailed(gettext("Deleted messages cannot be forwarded."), code="message_deleted")
    target = get_membership(user, target_conversation_id)
    return _create(
        user, target, body=source.body, client_id=client_id, forwarded_from=source, sticker=source.sticker
    )


def _create(
    user: Any,
    membership: Membership,
    *,
    body: Any,
    client_id: Any,
    reply_to_id: Any = None,
    attachment_ids: Any = (),
    forwarded_from: Message | None = None,
    sticker: Sticker | None = None,
) -> tuple[Message, bool]:
    conv = membership.conversation
    client_id = normalize_client_id(client_id)
    existing = message_queryset().filter(conversation=conv, sender=user, client_id=client_id).first()
    if existing is not None:
        return existing, False
    if not get_policy().can_send_message(user, conv, membership):
        raise PermissionDenied(gettext("You cannot send messages in this conversation."))
    body = normalize_body(body)
    attachment_ids = _attachment_ids(attachment_ids)
    copy_from = list(forwarded_from.attachments.all()) if forwarded_from is not None else []
    if sticker is not None and (body or attachment_ids):
        raise ValidationFailed(gettext("A sticker is sent on its own."), code="invalid_sticker")
    if not body and not attachment_ids and not copy_from and sticker is None:
        raise ValidationFailed(gettext("A message needs text or an attachment."), code="empty_message")
    reply_to = None
    if reply_to_id:
        try:
            reply_to = Message.objects.get(pk=reply_to_id, conversation=conv)
        except (Message.DoesNotExist, ValueError, DjangoValidationError) as exc:
            raise ValidationFailed(
                gettext("The replied message is not in this conversation."), code="invalid_reply"
            ) from exc

    now = timezone.now()
    try:
        with transaction.atomic():
            # The UPDATE takes a row lock: concurrent senders in this conversation are
            # serialized here, which makes seq gap-free and strictly increasing.
            Conversation.objects.filter(pk=conv.pk).update(
                last_seq=F("last_seq") + 1, last_message_at=now, last_activity_at=now
            )
            seq = Conversation.objects.values_list("last_seq", flat=True).get(pk=conv.pk)
            message = Message.objects.create(
                conversation=conv,
                sender=user,
                seq=seq,
                client_id=client_id,
                body=body,
                reply_to=reply_to,
                forwarded_from=forwarded_from,
                sticker=sticker,
                created_at=now,
            )
            if attachment_ids:
                _bind_attachments(user, conv, message, attachment_ids)
            for item in copy_from:
                Attachment.objects.create(
                    conversation=conv,
                    message=message,
                    uploaded_by=user,
                    file=item.file.name,
                    original_name=item.original_name,
                    content_type=item.content_type,
                    size=item.size,
                    width=item.width,
                    height=item.height,
                )
            # The sender has read their own message.
            Membership.objects.filter(pk=membership.pk, last_read_seq__lt=seq).update(last_read_seq=seq)
            message = message_queryset().get(pk=message.pk)
            payload = message_payload(message)
            events.to_conversation(conv.pk, "message.created", {"message": payload})
            transaction.on_commit(
                lambda: signals.message_created.send(sender=Message, message=message, created_by=user)
            )
    except IntegrityError:
        # Lost a race against an identical retry: return the winner.
        existing = message_queryset().filter(conversation=conv, sender=user, client_id=client_id).first()
        if existing is None:
            raise
        return existing, False
    return message, True


def _attachment_ids(value: Any) -> list[str]:
    if not value:
        return []
    if not isinstance(value, (list, tuple)):
        raise ValidationFailed(gettext("attachment_ids must be a list."), code="invalid_attachments")
    if not chat_settings.ENABLE_ATTACHMENTS:
        raise FeatureDisabled(gettext("Attachments are disabled."))
    ids = list(dict.fromkeys(str(v) for v in value))
    if len(ids) > chat_settings.MAX_ATTACHMENTS_PER_MESSAGE:
        raise ValidationFailed(gettext("Too many attachments."), code="too_many_attachments")
    return ids


def _bind_attachments(user: Any, conv: Conversation, message: Message, ids: list[str]) -> None:
    try:
        rows = list(
            Attachment.objects.select_for_update().filter(
                pk__in=ids, conversation=conv, uploaded_by=user, message__isnull=True
            )
        )
    except (ValueError, DjangoValidationError) as exc:
        raise ValidationFailed(gettext("Invalid attachment id."), code="invalid_attachments") from exc
    if len(rows) != len(ids):
        raise ValidationFailed(
            gettext("Attachments must be your own pending uploads in this conversation."),
            code="invalid_attachments",
        )
    Attachment.objects.filter(pk__in=[r.pk for r in rows]).update(message=message)


# --- history ------------------------------------------------------------------------


def _int_param(value: Any, name: str) -> int | None:
    if value in (None, ""):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValidationFailed(
            gettext("%(name)s must be an integer.") % {"name": name}, code="invalid_cursor"
        ) from exc
    if parsed < 0:
        raise ValidationFailed(gettext("%(name)s must be positive.") % {"name": name}, code="invalid_cursor")
    return parsed


def list_messages(
    user: Any,
    conversation_id: Any,
    *,
    before: Any = None,
    after: Any = None,
    limit: Any = PAGE_SIZE,
    updated_since: Any = None,
    pinned: bool = False,
) -> dict[str, Any]:
    """Cursor pagination by ``seq``. Results are always in ascending ``seq`` order.

    * no cursor / ``before=N``: the newest page (older than N); ``next_cursor`` continues backwards.
    * ``after=N``: messages newer than N (gap recovery); ``next_cursor`` continues forwards.
    * ``updated_since=<iso>``: messages edited/deleted/reacted since a timestamp (reconnect sync).
    """
    membership = get_membership(user, conversation_id)
    limit = _int_param(limit, "limit") or PAGE_SIZE
    limit = max(1, min(limit, MAX_PAGE_SIZE))
    qs = message_queryset().filter(conversation_id=membership.conversation_id)
    before, after = _int_param(before, "before"), _int_param(after, "after")
    if before is not None and after is not None:
        raise ValidationFailed(gettext("Use either before or after."), code="invalid_cursor")

    if pinned:
        rows = list(
            qs.filter(pinned_at__isnull=False, deleted_at__isnull=True).order_by("-pinned_at")[:MAX_PAGE_SIZE]
        )
        return {"results": [message_payload(m) for m in rows], "has_more": False, "next_cursor": None}
    if updated_since:
        moment = parse_datetime(str(updated_since)) if isinstance(updated_since, str) else updated_since
        if not isinstance(moment, datetime):
            raise ValidationFailed(
                gettext("updated_since must be an ISO 8601 timestamp."), code="invalid_cursor"
            )
        rows = list(qs.filter(updated_at__gt=moment).order_by("updated_at", "seq")[: MAX_PAGE_SIZE * 2 + 1])
        has_more = len(rows) > MAX_PAGE_SIZE * 2
        rows = rows[: MAX_PAGE_SIZE * 2]
        return {"results": [message_payload(m) for m in rows], "has_more": has_more, "next_cursor": None}
    if after is not None:
        rows = list(qs.filter(seq__gt=after).order_by("seq")[: limit + 1])
        has_more = len(rows) > limit
        rows = rows[:limit]
        cursor = str(rows[-1].seq) if has_more and rows else None
    else:
        if before is not None:
            qs = qs.filter(seq__lt=before)
        rows = list(qs.order_by("-seq")[: limit + 1])
        has_more = len(rows) > limit
        rows = list(reversed(rows[:limit]))
        cursor = str(rows[0].seq) if has_more and rows else None
    return {"results": [message_payload(m) for m in rows], "has_more": has_more, "next_cursor": cursor}


def search_messages(
    user: Any, query: Any, *, conversation_id: Any = None, before: Any = None
) -> dict[str, Any]:
    query = str(query or "").strip()
    if not 2 <= len(query) <= 100:
        raise ValidationFailed(
            gettext("Search must contain between 2 and 100 characters."), code="invalid_query"
        )
    qs = message_queryset().filter(
        conversation__memberships__user=user,
        conversation__memberships__left_at__isnull=True,
        deleted_at__isnull=True,
        body__icontains=query,
    )
    if conversation_id:
        get_membership(user, conversation_id)
        qs = qs.filter(conversation_id=conversation_id)
    if before:
        moment = parse_datetime(str(before))
        if moment is None:
            raise ValidationFailed(gettext("Invalid cursor."), code="invalid_cursor")
        qs = qs.filter(created_at__lt=moment)
    rows = list(qs.order_by("-created_at", "-seq")[:31])
    has_more = len(rows) > 30
    rows = rows[:30]
    return {
        "results": [message_payload(m) for m in rows],
        "has_more": has_more,
        "next_cursor": rows[-1].created_at.isoformat() if has_more and rows else None,
    }


# --- mutations ----------------------------------------------------------------------


def edit_message(user: Any, message_id: Any, body: Any) -> Message:
    with transaction.atomic():
        message, membership = _get_message(user, message_id, for_update=True)
        if message.deleted_at:
            raise ValidationFailed(gettext("Deleted messages cannot be edited."), code="message_deleted")
        if not get_policy().can_edit_message(user, message, membership):
            raise PermissionDenied(gettext("Only the sender can edit this message."))
        window = chat_settings.EDIT_WINDOW
        if window and timezone.now() - message.created_at > timedelta(seconds=window):
            raise PermissionDenied(gettext("The edit window has passed."), code="edit_window_expired")
        body = normalize_body(body)
        if not body and not message.attachments.exists():
            raise ValidationFailed(gettext("A message needs text or an attachment."), code="empty_message")
        if body != message.body:
            message.body = body
            message.edited_at = timezone.now()
            message.save(update_fields=["body", "edited_at", "updated_at"])
        message = message_queryset().get(pk=message.pk)
        events.to_conversation(
            message.conversation_id, "message.updated", {"message": message_payload(message)}
        )
        transaction.on_commit(
            lambda: signals.message_updated.send(sender=Message, message=message, updated_by=user)
        )
    return message


def delete_message(user: Any, message_id: Any) -> Message:
    """Soft delete: the row (and its seq) stays so ordering and replies remain stable."""
    with transaction.atomic():
        message, membership = _get_message(user, message_id, for_update=True)
        if message.deleted_at:
            return message_queryset().get(pk=message.pk)
        if not get_policy().can_delete_message(user, message, membership):
            raise PermissionDenied(gettext("You cannot delete this message."))
        attachments = list(message.attachments.all())
        message.body = ""
        message.deleted_at = timezone.now()
        message.pinned_at = None
        message.pinned_by = None
        message.save(update_fields=["body", "deleted_at", "pinned_at", "pinned_by", "updated_at"])
        message.reactions.all().delete()
        Attachment.objects.filter(pk__in=[a.pk for a in attachments]).delete()
        delete_attachment_files(attachments)
        message = message_queryset().get(pk=message.pk)
        events.to_conversation(
            message.conversation_id, "message.deleted", {"message": message_payload(message)}
        )
        transaction.on_commit(
            lambda: signals.message_deleted.send(sender=Message, message=message, deleted_by=user)
        )
    return message


def toggle_reaction(user: Any, message_id: Any, emoji: Any) -> dict[str, Any]:
    if not chat_settings.ENABLE_REACTIONS:
        raise FeatureDisabled(gettext("Reactions are disabled."))
    emoji = str(emoji or "").strip()
    allowed = chat_settings.ALLOWED_REACTIONS
    if (allowed is not None and emoji not in allowed) or not is_emoji(emoji, max_length=32):
        raise ValidationFailed(gettext("This reaction is not supported."), code="invalid_reaction")
    with transaction.atomic():
        message, _ = _get_message(user, message_id, for_update=True)
        if message.deleted_at:
            raise ValidationFailed(gettext("Deleted messages cannot be reacted to."), code="message_deleted")
        removed, _ = Reaction.objects.filter(message=message, user=user, emoji=emoji).delete()
        active = not removed
        if active:
            Reaction.objects.create(message=message, user=user, emoji=emoji)
        Message.objects.filter(pk=message.pk).update(updated_at=timezone.now())
        summary = reaction_summary(Message.objects.prefetch_related("reactions").get(pk=message.pk))
        events.to_conversation(
            message.conversation_id,
            "reaction.updated",
            {"message_id": str(message.pk), "seq": message.seq, "reactions": summary},
        )
    return {"message_id": str(message.pk), "emoji": emoji, "active": active, "reactions": summary}


def toggle_pin(user: Any, message_id: Any) -> Message:
    with transaction.atomic():
        message, membership = _get_message(user, message_id, for_update=True)
        if message.deleted_at:
            raise ValidationFailed(gettext("Deleted messages cannot be pinned."), code="message_deleted")
        if not get_policy().can_pin_message(user, message, membership):
            raise PermissionDenied(gettext("You cannot pin messages in this conversation."))
        if message.pinned_at:
            message.pinned_at, message.pinned_by = None, None
        else:
            message.pinned_at, message.pinned_by = timezone.now(), user
        message.save(update_fields=["pinned_at", "pinned_by", "updated_at"])
        message = message_queryset().get(pk=message.pk)
        events.to_conversation(
            message.conversation_id, "message.updated", {"message": message_payload(message)}
        )
    return message
