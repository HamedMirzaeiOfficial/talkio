"""Presence transitions (connection leases + durable last_seen)."""

from __future__ import annotations

from typing import Any

from django.utils import timezone

from .. import events
from ..models import Membership, UserPresence
from ..presence import get_presence_store


def _peer_conversations(user_id: Any) -> list[Any]:
    return list(
        Membership.objects.filter(user_id=user_id, left_at__isnull=True).values_list(
            "conversation_id", flat=True
        )
    )


def connection_opened(user_id: Any, connection_id: str) -> None:
    if get_presence_store().connect(user_id, connection_id):
        _broadcast(user_id, online=True, last_seen=None)


def heartbeat(user_id: Any, connection_id: str) -> None:
    get_presence_store().refresh(user_id, connection_id)


def connection_closed(user_id: Any, connection_id: str) -> None:
    if get_presence_store().disconnect(user_id, connection_id):
        now = timezone.now()
        UserPresence.objects.update_or_create(user_id=user_id, defaults={"last_seen_at": now})
        _broadcast(user_id, online=False, last_seen=now)


def _broadcast(user_id: Any, *, online: bool, last_seen: Any) -> None:
    payload = {
        "user_id": user_id,
        "online": online,
        "last_seen_at": last_seen.isoformat() if last_seen else None,
    }
    for conversation_id in _peer_conversations(user_id):
        events.to_conversation(conversation_id, "presence.updated", payload)
