"""Fan-out of committed changes to WebSocket subscribers via the channel layer.

All broadcasts are scheduled with ``transaction.on_commit`` so that subscribers never
observe rolled-back data. Delivery is best effort (at-most-once per socket); clients
recover gaps through the history API using per-conversation ``seq`` numbers.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable
from typing import Any

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

logger = logging.getLogger("django_realtime_chat")
_SAFE = re.compile(r"[^0-9A-Za-z_.-]")

# Handler name on the consumer ("chat.event" -> chat_event).
HANDLER = "chat.event"


def conversation_group(conversation_id: Any) -> str:
    return f"rtchat.c.{_SAFE.sub('', str(conversation_id))}"


def user_group(user_id: Any) -> str:
    return f"rtchat.u.{_SAFE.sub('', str(user_id))[:80]}"


def _send(group: str, event: dict[str, Any]) -> None:
    layer = get_channel_layer()
    if layer is None:
        return
    try:
        async_to_sync(layer.group_send)(group, {"type": HANDLER, "event": event})
    except Exception:  # pragma: no cover - transport failures must not break writes
        logger.exception("chat broadcast failed", extra={"group": group, "event_type": event.get("type")})


def to_conversation(conversation_id: Any, event_type: str, payload: dict[str, Any]) -> None:
    event = {"type": event_type, "conversation_id": str(conversation_id), **payload}
    transaction.on_commit(lambda: _send(conversation_group(conversation_id), event))


def to_users(user_ids: Iterable[Any], event_type: str, payload_for: Any) -> None:
    """``payload_for`` is a dict or a callable(user_id) -> dict for viewer-specific payloads."""
    ids = list(dict.fromkeys(user_ids))

    def deliver() -> None:
        for uid in ids:
            payload = payload_for(uid) if callable(payload_for) else payload_for
            if payload is not None:
                _send(user_group(uid), {"type": event_type, **payload})

    transaction.on_commit(deliver)
