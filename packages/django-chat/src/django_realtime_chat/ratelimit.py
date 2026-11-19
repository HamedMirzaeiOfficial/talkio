"""Rate limiting for HTTP (DRF throttles, shared cache) and WebSocket (per connection)."""

from __future__ import annotations

import time

from rest_framework.throttling import SimpleRateThrottle

from .conf import chat_settings


class TokenBucket:
    """In-memory token bucket; one instance per WebSocket connection and category."""

    def __init__(self, count: int, period: float) -> None:
        self.capacity = float(count)
        self.rate = count / period
        self.tokens = float(count)
        self.updated = time.monotonic()

    def take(self) -> float | None:
        """Consume a token. Returns None on success or seconds until a token is available."""
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.updated) * self.rate)
        self.updated = now
        if self.tokens >= 1:
            self.tokens -= 1
            return None
        return (1 - self.tokens) / self.rate

    @classmethod
    def for_key(cls, key: str) -> TokenBucket:
        rate = chat_settings.rate(key)
        return cls(rate.count, rate.period)


class ChatThrottle(SimpleRateThrottle):
    """DRF throttle keyed per user; rate read from ``CHAT_RATE_LIMITS[scope]``."""

    scope = "http_write"

    def get_rate(self) -> str:
        return chat_settings.RATE_LIMITS[self.scope]

    def parse_rate(self, rate):
        parsed = chat_settings.rate(self.scope)
        return parsed.count, parsed.period

    def get_cache_key(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return None
        return f"rtchat:throttle:{self.scope}:{request.user.pk}"


class WriteThrottle(ChatThrottle):
    scope = "http_write"


class UploadThrottle(ChatThrottle):
    scope = "http_upload"


class SearchThrottle(ChatThrottle):
    scope = "http_search"
