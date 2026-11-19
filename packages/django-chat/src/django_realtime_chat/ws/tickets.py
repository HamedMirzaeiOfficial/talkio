"""Signed, short-lived, single-use WebSocket tickets.

Used when the browser cannot present the session cookie to the WebSocket endpoint
(e.g. the chat backend is on another origin, or the host uses bearer tokens). The
client fetches a ticket over authenticated HTTPS and appends ``?ticket=...`` to the
socket URL. Tickets are signed with Django's ``SECRET_KEY`` (never exposed) and expire
after ``CHAT_WS_TICKET_TTL`` seconds.
"""

from __future__ import annotations

import secrets
from typing import Any

from django.contrib.auth import get_user_model
from django.core import signing
from django.core.cache import cache

from ..conf import chat_settings

SALT = "django_realtime_chat.ws-ticket"


def issue_ticket(user: Any) -> str:
    return signing.dumps({"u": str(user.pk), "n": secrets.token_urlsafe(12)}, salt=SALT, compress=True)


def redeem_ticket(ticket: str) -> Any | None:
    """Return the active user for a valid, unused ticket; ``None`` otherwise."""
    try:
        data = signing.loads(ticket, salt=SALT, max_age=chat_settings.WS_TICKET_TTL)
    except signing.BadSignature:
        return None
    # cache.add is atomic on Redis/Memcached/LocMem: a ticket can be redeemed once.
    if not cache.add(f"rtchat:ticket:{data['n']}", 1, timeout=chat_settings.WS_TICKET_TTL + 5):
        return None
    user = get_user_model()._default_manager.filter(pk=data["u"]).first()
    if user is None or not getattr(user, "is_active", True):
        return None
    return user
