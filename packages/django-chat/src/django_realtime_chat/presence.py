"""Transient multi-device presence.

Each WebSocket connection holds a *lease* (connection id → expiry). A user is online
while at least one unexpired lease exists, so several tabs/devices are handled and a
crashed worker's leases simply expire after ``CHAT_PRESENCE_TTL`` seconds.
Durable ``last_seen_at`` is stored separately in ``UserPresence``.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Iterable
from functools import lru_cache
from typing import Any, Protocol

from .conf import chat_settings


class PresenceStore(Protocol):
    def connect(self, user_id: Any, connection_id: str) -> bool:
        """Register a lease. Returns True when the user just came online."""

    def refresh(self, user_id: Any, connection_id: str) -> None: ...

    def disconnect(self, user_id: Any, connection_id: str) -> bool:
        """Drop a lease. Returns True when the user has no live lease left."""

    def online_user_ids(self, user_ids: Iterable[Any]) -> set[Any]: ...


class MemoryPresenceStore:
    """Process-local store for development and tests."""

    def __init__(self) -> None:
        self._leases: dict[Any, dict[str, float]] = {}
        self._lock = threading.Lock()

    def _prune(self, user_id: Any, now: float) -> dict[str, float]:
        leases = self._leases.setdefault(user_id, {})
        for conn, expiry in list(leases.items()):
            if expiry <= now:
                del leases[conn]
        return leases

    def connect(self, user_id: Any, connection_id: str) -> bool:
        now = time.monotonic()
        with self._lock:
            leases = self._prune(user_id, now)
            was_offline = not leases
            leases[connection_id] = now + chat_settings.PRESENCE_TTL
            return was_offline

    def refresh(self, user_id: Any, connection_id: str) -> None:
        now = time.monotonic()
        with self._lock:
            self._prune(user_id, now)[connection_id] = now + chat_settings.PRESENCE_TTL

    def disconnect(self, user_id: Any, connection_id: str) -> bool:
        now = time.monotonic()
        with self._lock:
            leases = self._prune(user_id, now)
            leases.pop(connection_id, None)
            return not leases

    def online_user_ids(self, user_ids: Iterable[Any]) -> set[Any]:
        now = time.monotonic()
        with self._lock:
            return {uid for uid in user_ids if self._prune(uid, now)}

    def clear(self) -> None:
        with self._lock:
            self._leases.clear()


class RedisPresenceStore:
    """Sorted set per user: member = connection id, score = expiry (unix time)."""

    def __init__(self, url: str) -> None:
        import redis  # optional dependency: pip install django-realtime-chat[redis]

        self.client = redis.Redis.from_url(url)

    @staticmethod
    def key(user_id: Any) -> str:
        return f"rtchat:presence:{user_id}"

    def connect(self, user_id: Any, connection_id: str) -> bool:
        now, ttl = time.time(), chat_settings.PRESENCE_TTL
        pipe = self.client.pipeline()
        pipe.zremrangebyscore(self.key(user_id), "-inf", now)
        pipe.zcard(self.key(user_id))
        pipe.zadd(self.key(user_id), {connection_id: now + ttl})
        pipe.expire(self.key(user_id), ttl * 2)
        _, before, _, _ = pipe.execute()
        return before == 0

    def refresh(self, user_id: Any, connection_id: str) -> None:
        ttl = chat_settings.PRESENCE_TTL
        pipe = self.client.pipeline()
        pipe.zadd(self.key(user_id), {connection_id: time.time() + ttl})
        pipe.expire(self.key(user_id), ttl * 2)
        pipe.execute()

    def disconnect(self, user_id: Any, connection_id: str) -> bool:
        pipe = self.client.pipeline()
        pipe.zrem(self.key(user_id), connection_id)
        pipe.zremrangebyscore(self.key(user_id), "-inf", time.time())
        pipe.zcard(self.key(user_id))
        _, _, remaining = pipe.execute()
        return remaining == 0

    def online_user_ids(self, user_ids: Iterable[Any]) -> set[Any]:
        ids = list(user_ids)
        if not ids:
            return set()
        now = time.time()
        pipe = self.client.pipeline()
        for uid in ids:
            pipe.zcount(self.key(uid), now, "+inf")
        return {uid for uid, count in zip(ids, pipe.execute(), strict=True) if count}


@lru_cache(maxsize=4)
def _store_for(backend: str, url: str | None) -> PresenceStore:
    if backend == "redis":
        return RedisPresenceStore(url or "")
    return MemoryPresenceStore()


def get_presence_store() -> PresenceStore:
    return _store_for(chat_settings.PRESENCE_BACKEND, chat_settings.REDIS_URL)
