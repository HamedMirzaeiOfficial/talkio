"""Canonical JSON payloads shared by REST responses and WebSocket events.

Payload builders are plain functions so that both transports emit identical shapes.
Field names follow ``docs/api`` and are part of the public contract.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from django.db.models import Count, IntegerField, OuterRef, Prefetch, Q, QuerySet, Subquery, Value
from django.db.models.functions import Coalesce
from django.urls import reverse

from .models import Attachment, Conversation, Membership, Message, Sticker, StickerPack, UserPresence
from .presence import get_presence_store
from .users import get_user_adapter, serialize_user

REPLY_EXCERPT = 280


def iso(value: Any) -> str | None:
    return value.isoformat() if value else None


def message_queryset() -> QuerySet:
    return Message.objects.select_related(
        "sender", "reply_to", "reply_to__sender", "forwarded_from", "forwarded_from__sender", "sticker"
    ).prefetch_related("attachments", "reactions")


def sticker_payload(sticker: Sticker) -> dict[str, Any]:
    return {
        "id": str(sticker.pk),
        "pack_id": str(sticker.pack_id),
        "emoji": sticker.emoji,
        "content_type": sticker.content_type,
        "width": sticker.width,
        "height": sticker.height,
        "url": reverse("realtime_chat:sticker-file", args=[sticker.pk]),
    }


def sticker_pack_payload(pack: StickerPack) -> dict[str, Any]:
    return {
        "id": str(pack.pk),
        "name": pack.name,
        "stickers": [sticker_payload(s) for s in pack.stickers.all()],
    }


def attachment_payload(attachment: Attachment) -> dict[str, Any]:
    return {
        "id": str(attachment.pk),
        "conversation_id": str(attachment.conversation_id),
        "message_id": str(attachment.message_id) if attachment.message_id else None,
        "name": attachment.original_name,
        "content_type": attachment.content_type,
        "size": attachment.size,
        "width": attachment.width,
        "height": attachment.height,
        "url": reverse("realtime_chat:attachment-download", args=[attachment.pk]),
        "thumbnail_url": (
            reverse("realtime_chat:attachment-download", args=[attachment.pk]) + "?variant=thumb"
            if attachment.thumbnail
            else None
        ),
        "is_voice": attachment.is_voice,
        "duration": attachment.duration,
        "waveform": attachment.waveform,
        "created_at": iso(attachment.created_at),
    }


def reaction_summary(message: Message) -> list[dict[str, Any]]:
    groups: dict[str, list[Any]] = {}
    for reaction in message.reactions.all():
        groups.setdefault(reaction.emoji, []).append(reaction.user_id)
    return [{"emoji": emoji, "count": len(users), "user_ids": users} for emoji, users in groups.items()]


def _message_ref(message: Message | None) -> dict[str, Any] | None:
    if message is None:
        return None
    return {
        "id": str(message.pk),
        "seq": message.seq,
        "conversation_id": str(message.conversation_id),
        "sender": serialize_user(message.sender),
        "body": "" if message.deleted_at else message.body[:REPLY_EXCERPT],
        "is_deleted": message.deleted_at is not None,
        "kind": _kind(message),
    }


def _kind(message: Message) -> str:
    """Short description of non-text content for previews and reply quotes."""
    if message.sticker_id:
        return "sticker"
    attachments = list(message.attachments.all())
    if not attachments:
        return "text"
    first = attachments[0]
    if first.is_voice:
        return "voice"
    if first.content_type == "image/gif":
        return "gif"
    return (
        first.content_type.split("/")[0]
        if first.content_type.split("/")[0] in {"image", "video", "audio"}
        else "file"
    )


def message_payload(message: Message) -> dict[str, Any]:
    deleted = message.deleted_at is not None
    return {
        "id": str(message.pk),
        "conversation_id": str(message.conversation_id),
        "seq": message.seq,
        "client_id": message.client_id,
        "sender": serialize_user(message.sender),
        "body": "" if deleted else message.body,
        "created_at": iso(message.created_at),
        "edited_at": iso(message.edited_at),
        "deleted_at": iso(message.deleted_at),
        "is_deleted": deleted,
        "reply_to": _message_ref(message.reply_to),
        "forwarded_from": _message_ref(message.forwarded_from),
        "pinned_at": iso(message.pinned_at),
        "attachments": [] if deleted else [attachment_payload(a) for a in message.attachments.all()],
        "sticker": sticker_payload(message.sticker) if message.sticker_id and not deleted else None,
        "reactions": [] if deleted else reaction_summary(message),
        "kind": "deleted" if deleted else _kind(message),
    }


def presence_payload(user_ids: Iterable[Any]) -> dict[Any, dict[str, Any]]:
    ids = list(dict.fromkeys(user_ids))
    if not ids:
        return {}
    online = get_presence_store().online_user_ids(ids)
    seen = dict(UserPresence.objects.filter(user_id__in=ids).values_list("user_id", "last_seen_at"))
    return {uid: {"online": uid in online, "last_seen_at": iso(seen.get(uid))} for uid in ids}


def user_profile_payload(user: Any) -> dict[str, Any]:
    data = serialize_user(user) or {}
    data.update(presence_payload([user.pk]).get(user.pk, {"online": False, "last_seen_at": None}))
    return data


def annotate_for_viewer(queryset: QuerySet, user: Any) -> QuerySet:
    my_membership = Membership.objects.filter(conversation=OuterRef("pk"), user=user)
    unread = (
        Message.objects.filter(
            conversation=OuterRef("pk"), seq__gt=OuterRef("my_last_read_seq"), deleted_at__isnull=True
        )
        .exclude(sender=user)
        .order_by()
        .values("conversation")
        .annotate(total=Count("pk"))
        .values("total")
    )
    return queryset.annotate(
        my_last_read_seq=Subquery(my_membership.values("last_read_seq")[:1]),
        my_role=Subquery(my_membership.values("role")[:1]),
    ).annotate(
        unread_count=Coalesce(Subquery(unread, output_field=IntegerField()), Value(0)),
    )


def conversation_queryset_for(user: Any) -> QuerySet:
    active_members = (
        Membership.objects.filter(left_at__isnull=True).select_related("user").order_by("joined_at", "pk")
    )
    qs = Conversation.objects.filter(memberships__user=user, memberships__left_at__isnull=True)
    return annotate_for_viewer(qs, user).prefetch_related(
        Prefetch("memberships", queryset=active_members, to_attr="active_memberships")
    )


def conversation_payloads(conversations: list[Conversation], viewer: Any) -> list[dict[str, Any]]:
    """Viewer-specific payloads (title of a direct chat, unread count, role)."""
    if not conversations:
        return []
    last_filter = Q()
    for conv in conversations:
        if conv.last_seq:
            last_filter |= Q(conversation_id=conv.pk, seq=conv.last_seq)
    last_messages = {}
    if last_filter:
        last_messages = {m.conversation_id: m for m in message_queryset().filter(last_filter)}
    member_ids = {m.user_id for conv in conversations for m in _members(conv)}
    presence = presence_payload(member_ids)
    adapter = get_user_adapter()
    payloads = []
    for conv in conversations:
        members = _members(conv)
        peer = next((m.user for m in members if m.user_id != viewer.pk), None) if not conv.is_group else None
        title = conv.title
        if not conv.is_group:
            title = adapter.display_name(peer) if peer is not None else "Saved messages"
        last = last_messages.get(conv.pk)
        payloads.append(
            {
                "id": str(conv.pk),
                "kind": conv.kind,
                "title": title,
                "description": conv.description,
                "created_at": iso(conv.created_at),
                "last_seq": conv.last_seq,
                "last_message": message_payload(last) if last else None,
                "last_activity_at": iso(conv.last_activity_at),
                "unread_count": getattr(conv, "unread_count", 0) or 0,
                "my_role": getattr(conv, "my_role", None),
                "my_last_read_seq": getattr(conv, "my_last_read_seq", 0) or 0,
                "member_count": len(members),
                "peer": _member_payload(peer, None, presence) if peer is not None else None,
                "members": [_member_payload(m.user, m, presence) for m in members],
            }
        )
    return payloads


def conversation_payload(conversation: Conversation, viewer: Any) -> dict[str, Any]:
    fresh = conversation_queryset_for(viewer).get(pk=conversation.pk)
    return conversation_payloads([fresh], viewer)[0]


def _members(conv: Conversation) -> list[Membership]:
    members = getattr(conv, "active_memberships", None)
    if members is None:
        members = list(
            conv.memberships.filter(left_at__isnull=True).select_related("user").order_by("joined_at")
        )
        conv.active_memberships = members
    return members


def _member_payload(user: Any, membership: Membership | None, presence: dict) -> dict[str, Any]:
    data = serialize_user(user) or {}
    data.update(presence.get(user.pk, {"online": False, "last_seen_at": None}))
    if membership is not None:
        data["role"] = membership.role
        data["last_read_seq"] = membership.last_read_seq
        data["joined_at"] = iso(membership.joined_at)
    return data
