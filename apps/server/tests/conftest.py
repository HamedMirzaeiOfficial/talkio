import pytest
from rest_framework.test import APIClient

from accounts.models import User


@pytest.fixture(autouse=True)
def _settings(settings, tmp_path):
    settings.DEBUG = True
    settings.MEDIA_ROOT = tmp_path / "media"
    settings.STORAGES = {
        **settings.STORAGES,
        "default": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
        "chat_attachments": {"BACKEND": "django.core.files.storage.InMemoryStorage"},
    }
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
    from django.core.cache import cache

    cache.clear()


@pytest.fixture
def alice(db):
    return User.objects.create_user(
        username="alice", password="Correct-horse-9", first_name="Alice", email="alice@example.com"
    )


@pytest.fixture
def bob(db):
    return User.objects.create_user(username="bob", password="Correct-horse-9", first_name="Bob")


@pytest.fixture
def legacy_phone_user(db):
    # Created like the previous phone-based flow did: username == phone.
    return User.objects.create_user(phone="09120000001", password="Correct-horse-9", first_name="Parisa")


def authed(user):
    client = APIClient()
    client.force_authenticate(user)
    return client
