"""RedisPresenceStore against a Redis protocol implementation (fakeredis)."""

import time

import pytest

fakeredis = pytest.importorskip("fakeredis")

from django_realtime_chat.presence import RedisPresenceStore  # noqa: E402


@pytest.fixture
def store(monkeypatch):
    instance = RedisPresenceStore.__new__(RedisPresenceStore)
    instance.client = fakeredis.FakeRedis()
    return instance


def test_multi_device_leases(store, settings):
    settings.CHAT_PRESENCE_TTL = 60
    assert store.connect(1, "phone") is True  # came online
    assert store.connect(1, "laptop") is False  # already online
    assert store.online_user_ids([1, 2]) == {1}
    assert store.disconnect(1, "phone") is False  # laptop still connected
    assert store.disconnect(1, "laptop") is True  # now offline
    assert store.online_user_ids([1]) == set()


def test_expired_leases_are_ignored(store, settings, monkeypatch):
    settings.CHAT_PRESENCE_TTL = 1
    store.connect(7, "crashed-worker")
    now = time.time()
    monkeypatch.setattr(time, "time", lambda: now + 5)
    assert store.online_user_ids([7]) == set()
    assert store.connect(7, "new") is True  # stale lease pruned, user "comes online" again


def test_refresh_extends_lease(store, settings, monkeypatch):
    settings.CHAT_PRESENCE_TTL = 10
    start = time.time()
    store.connect(3, "c")
    monkeypatch.setattr(time, "time", lambda: start + 8)
    store.refresh(3, "c")
    monkeypatch.setattr(time, "time", lambda: start + 15)
    assert store.online_user_ids([3]) == {3}
