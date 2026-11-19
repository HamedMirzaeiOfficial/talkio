"""Package settings.

Every setting is read lazily from ``django.conf.settings`` with a ``CHAT_`` prefix so
that ``override_settings`` works in tests and host projects can configure the package
without importing it. Values are validated by system checks (see ``checks.py``).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.utils.module_loading import import_string

DEFAULTS: dict[str, Any] = {
    "ENABLE_GROUPS": True,
    "ENABLE_ATTACHMENTS": True,
    "ENABLE_REACTIONS": True,
    "ENABLE_USER_SEARCH": True,
    "ENABLE_STICKERS": True,
    "ENABLE_VOICE": True,
    "MAX_MESSAGE_LENGTH": 4000,
    "MAX_ATTACHMENT_SIZE": 10 * 1024 * 1024,
    "MAX_ATTACHMENTS_PER_MESSAGE": 10,
    "MAX_PENDING_ATTACHMENTS": 20,
    "MAX_GROUP_MEMBERS": 256,
    "MAX_TITLE_LENGTH": 120,
    "MAX_VOICE_DURATION": 600,
    "MAX_STICKER_SIZE": 512 * 1024,
    # Longest side of generated image previews, in pixels.
    "THUMBNAIL_SIZE": 480,
    "ALLOWED_ATTACHMENT_TYPES": (
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "application/pdf",
        "text/plain",
        "audio/mpeg",
        "audio/ogg",
        "audio/wav",
        "audio/webm",
        "audio/mp4",
        "video/mp4",
        "video/webm",
    ),
    "ATTACHMENT_STORAGE": "default",
    "ATTACHMENT_UPLOAD_TO": "chat/attachments/%Y/%m/",
    # None = any single emoji. A list restricts reactions to those emoji.
    "ALLOWED_REACTIONS": None,
    # Offered first in reaction pickers.
    "QUICK_REACTIONS": ("👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀"),
    # Policy toggles consumed by the default ChatPolicy.
    "DEFAULT_PERMISSIONS": {
        "members_can_add_members": False,
        "members_can_edit_info": False,
        "members_can_pin": True,
        "admins_can_delete_messages": True,
    },
    "POLICY": "django_realtime_chat.permissions.ChatPolicy",
    "USER_ADAPTER": "django_realtime_chat.users.DefaultUserAdapter",
    # Seconds a connection lease stays valid without a heartbeat.
    "PRESENCE_TTL": 60,
    # "memory" (single process, development) or "redis" (multi-process).
    "PRESENCE_BACKEND": "memory",
    "REDIS_URL": None,
    "TYPING_TIMEOUT": 6,
    # None = unlimited. Seconds after creation during which the sender may edit.
    "EDIT_WINDOW": None,
    "WS_TICKET_TTL": 60,
    # Optional DRF authentication classes for the chat API. None = host DRF defaults.
    "API_AUTHENTICATION_CLASSES": None,
    # "<count>/<period>" where period is s, m, h or e.g. 10s.
    "RATE_LIMITS": {
        "http_write": "120/m",
        "http_upload": "30/m",
        "http_search": "60/m",
        "ws_message": "30/10s",
        "ws_typing": "20/10s",
        "ws_other": "60/10s",
    },
}

_RATE_RE = re.compile(r"^(?P<count>\d+)/(?P<mult>\d*)(?P<unit>[smh])$")
_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600}


@dataclass(frozen=True)
class Rate:
    count: int
    period: float

    @classmethod
    def parse(cls, value: str) -> Rate:
        match = _RATE_RE.match(str(value).strip())
        if not match:
            raise ImproperlyConfigured(f"Invalid rate {value!r}; expected e.g. '30/m' or '20/10s'.")
        mult = int(match["mult"] or 1)
        return cls(count=int(match["count"]), period=float(mult * _UNIT_SECONDS[match["unit"]]))


class ChatSettings:
    """Attribute access to ``CHAT_*`` settings with package defaults."""

    def __getattr__(self, name: str) -> Any:
        if name not in DEFAULTS:
            raise AttributeError(f"Unknown chat setting {name!r}")
        value = getattr(settings, f"CHAT_{name}", DEFAULTS[name])
        if isinstance(DEFAULTS[name], dict):
            merged = dict(DEFAULTS[name])
            merged.update(value or {})
            return merged
        return value

    def rate(self, key: str) -> Rate:
        return Rate.parse(self.RATE_LIMITS[key])

    def import_setting(self, name: str) -> Any:
        path = getattr(self, name)
        try:
            return import_string(path) if isinstance(path, str) else path
        except ImportError as exc:
            raise ImproperlyConfigured(f"CHAT_{name}={path!r} cannot be imported: {exc}") from exc


chat_settings = ChatSettings()
