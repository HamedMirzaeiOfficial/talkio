import io

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from django_realtime_chat.presence import get_presence_store


@pytest.fixture(autouse=True)
def _isolate_state(settings):
    from django.core.cache import cache

    cache.clear()
    store = get_presence_store()
    if hasattr(store, "clear"):
        store.clear()
    yield
    cache.clear()


def make_user(username, **extra):
    return get_user_model().objects.create_user(username=username, password="pw-123456", **extra)


@pytest.fixture
def alice(db):
    return make_user("alice", first_name="Alice", last_name="Anders")


@pytest.fixture
def bob(db):
    return make_user("bob", first_name="Bob")


@pytest.fixture
def carol(db):
    return make_user("carol", first_name="Carol")


@pytest.fixture
def mallory(db):
    return make_user("mallory", first_name="Mallory")


def client_for(user):
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def api(alice):
    return client_for(alice)


@pytest.fixture
def group(alice, bob, carol):
    from django_realtime_chat.services.conversations import create_group

    return create_group(alice, title="Design", member_ids=[bob.pk, carol.pk])


@pytest.fixture
def direct(alice, bob):
    from django_realtime_chat.services.conversations import start_direct

    return start_direct(alice, bob.pk)[0]


def png_bytes(size=(4, 3)):
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", size, (90, 100, 200)).save(buffer, format="PNG")
    return buffer.getvalue()
