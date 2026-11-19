"""System checks validating ``CHAT_*`` configuration at startup."""

from __future__ import annotations

from django.conf import settings
from django.core.checks import Error, Tags, Warning, register
from django.core.exceptions import ImproperlyConfigured

from .conf import DEFAULTS, Rate, chat_settings
from .emoji import is_emoji

_POSITIVE_INTS = (
    "MAX_MESSAGE_LENGTH",
    "MAX_ATTACHMENT_SIZE",
    "MAX_ATTACHMENTS_PER_MESSAGE",
    "MAX_PENDING_ATTACHMENTS",
    "MAX_GROUP_MEMBERS",
    "MAX_TITLE_LENGTH",
    "PRESENCE_TTL",
    "TYPING_TIMEOUT",
    "WS_TICKET_TTL",
    "MAX_VOICE_DURATION",
    "MAX_STICKER_SIZE",
    "THUMBNAIL_SIZE",
)
_BOOLS = (
    "ENABLE_GROUPS",
    "ENABLE_ATTACHMENTS",
    "ENABLE_REACTIONS",
    "ENABLE_USER_SEARCH",
    "ENABLE_STICKERS",
    "ENABLE_VOICE",
)
_BLOCKED_TYPES = {
    "image/svg+xml",
    "text/html",
    "application/xhtml+xml",
    "application/javascript",
    "text/javascript",
}


@register(Tags.compatibility)
def check_chat_settings(app_configs=None, **kwargs):
    errors = []
    for name in dir(settings):
        if name.startswith("CHAT_") and name[5:] not in DEFAULTS:
            errors.append(Warning(f"Unknown setting {name}.", id="realtime_chat.W001"))
    for name in _POSITIVE_INTS:
        value = getattr(chat_settings, name)
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            errors.append(Error(f"CHAT_{name} must be a positive integer.", id="realtime_chat.E001"))
    for name in _BOOLS:
        if not isinstance(getattr(chat_settings, name), bool):
            errors.append(Error(f"CHAT_{name} must be a boolean.", id="realtime_chat.E002"))
    window = chat_settings.EDIT_WINDOW
    if window is not None and (not isinstance(window, int) or window <= 0):
        errors.append(Error("CHAT_EDIT_WINDOW must be None or a positive integer.", id="realtime_chat.E003"))
    backend = chat_settings.PRESENCE_BACKEND
    if backend not in {"memory", "redis"}:
        errors.append(Error("CHAT_PRESENCE_BACKEND must be 'memory' or 'redis'.", id="realtime_chat.E004"))
    elif backend == "redis" and not chat_settings.REDIS_URL:
        errors.append(
            Error("CHAT_REDIS_URL is required when CHAT_PRESENCE_BACKEND='redis'.", id="realtime_chat.E005")
        )
    elif backend == "memory" and not settings.DEBUG:
        errors.append(
            Warning(
                "CHAT_PRESENCE_BACKEND='memory' is process-local; use 'redis' with multiple workers.",
                id="realtime_chat.W002",
            )
        )
    for key, value in chat_settings.RATE_LIMITS.items():
        try:
            Rate.parse(value)
        except ImproperlyConfigured as exc:
            errors.append(Error(f"CHAT_RATE_LIMITS[{key!r}]: {exc}", id="realtime_chat.E006"))
    unsafe = _BLOCKED_TYPES.intersection(chat_settings.ALLOWED_ATTACHMENT_TYPES)
    if unsafe:
        errors.append(
            Error(
                f"CHAT_ALLOWED_ATTACHMENT_TYPES contains active content types: {sorted(unsafe)}.",
                id="realtime_chat.E007",
            )
        )
    for name in ("POLICY", "USER_ADAPTER"):
        try:
            chat_settings.import_setting(name)
        except ImproperlyConfigured as exc:
            errors.append(Error(str(exc), id="realtime_chat.E008"))
    allowed = chat_settings.ALLOWED_REACTIONS
    if allowed is not None and (not allowed or not all(is_emoji(e) for e in allowed)):
        errors.append(
            Error(
                "CHAT_ALLOWED_REACTIONS must be None or a non-empty list of emoji.", id="realtime_chat.E009"
            )
        )
    return errors
