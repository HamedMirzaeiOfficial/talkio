"""The standalone app consumes the reusable package exactly like a third-party host."""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django_realtime_chat.models import Attachment

from .conftest import authed


def test_chat_api_is_mounted_and_uses_accounts_users(alice, bob):
    response = authed(alice).post("/api/chat/v1/conversations/", {"kind": "direct", "user_id": bob.pk}, format="json")
    assert response.status_code == 201
    assert response.json()["conversation"]["peer"]["display_name"] == "Bob"


def test_phone_numbers_are_never_exposed(alice, legacy_phone_user):
    results = authed(alice).get("/api/chat/v1/users/search/?q=Parisa").json()["results"]
    assert results[0]["display_name"] == "Parisa"
    assert results[0]["username"] is None
    assert "09120000001" not in str(results)


def test_legacy_api_answers_410_with_migration_hint(alice):
    response = authed(alice).get("/api/v1/conversations/")
    assert response.status_code == 410
    assert response.json()["error"]["code"] == "api_version_removed"


def test_health_endpoints(db):
    from rest_framework.test import APIClient

    assert APIClient().get("/api/health/").json() == {"status": "ok"}
    assert APIClient().get("/api/health/ready/").json()["checks"]["database"] is True


def test_attachments_use_private_storage_not_public_media(alice, bob, client):
    from django_realtime_chat.services.conversations import start_direct

    conv, _ = start_direct(alice, bob.pk)
    upload = SimpleUploadedFile("notes.txt", b"private", content_type="text/plain")
    data = (
        authed(alice)
        .post("/api/chat/v1/attachments/", {"conversation_id": str(conv.pk), "file": upload}, format="multipart")
        .json()
    )
    attachment = Attachment.objects.get(pk=data["attachment"]["id"])
    from django.core.files.storage import storages

    assert storages["chat_attachments"].exists(attachment.file.name)
    assert not storages["default"].exists(attachment.file.name)
    # The public media route only serves avatars.
    assert client.get(f"/media/{attachment.file.name}").status_code == 404


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_asgi_websocket_requires_allowed_origin(settings):
    from channels.testing import WebsocketCommunicator

    from core.asgi import application

    bad = WebsocketCommunicator(application, "/ws/chat/v1/", headers=[(b"origin", b"https://evil.example")])
    connected, _ = await bad.connect()
    assert not connected
    good = WebsocketCommunicator(application, "/ws/chat/v1/", headers=[(b"origin", b"http://localhost")])
    connected, _ = await good.connect()
    assert connected
    assert (await good.receive_json_from())["code"] == "not_authenticated"
    await good.disconnect()
