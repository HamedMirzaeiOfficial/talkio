from django.core.files.uploadedfile import SimpleUploadedFile

from django_realtime_chat.models import Attachment

from .conftest import client_for, png_bytes

BASE = "/api/chat/v1"


def upload(client, conv, name, content, declared="application/octet-stream"):
    file = SimpleUploadedFile(name, content, content_type=declared)
    return client.post(
        f"{BASE}/attachments/", {"conversation_id": str(conv.pk), "file": file}, format="multipart"
    )


def test_upload_detects_type_and_dimensions(api, group):
    response = upload(api, group, "photo.png", png_bytes((8, 5)), declared="text/html")
    assert response.status_code == 201
    data = response.json()["attachment"]
    assert data["content_type"] == "image/png"  # detected, not the declared type
    assert (data["width"], data["height"]) == (8, 5)
    assert data["message_id"] is None
    stored = Attachment.objects.get(pk=data["id"])
    assert stored.file.name.endswith(".png") and "photo" not in stored.file.name


def test_active_content_and_spoofed_types_are_rejected(api, group):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    assert (
        upload(api, group, "x.svg", svg, "image/svg+xml").json()["error"]["code"] == "unsupported_file_type"
    )
    assert (
        upload(api, group, "x.png", b"MZ\x90\x00binary", "image/png").json()["error"]["code"]
        == "unsupported_file_type"
    )
    assert upload(api, group, "a.html", b"<!doctype html><p>x", "text/plain").status_code == 400
    assert (
        upload(api, group, "fake.png", b"\x89PNG\r\n\x1a\n" + b"garbage" * 10, "image/png").json()["error"][
            "code"
        ]
        == "invalid_image"
    )


def test_text_files_are_accepted(api, group):
    data = upload(api, group, "notes.txt", "سلام world".encode(), "text/plain").json()["attachment"]
    assert data["content_type"] == "text/plain"


def test_size_limit_is_enforced(api, group, settings):
    settings.CHAT_MAX_ATTACHMENT_SIZE = 10
    response = upload(api, group, "notes.txt", b"0123456789A", "text/plain")
    assert response.json()["error"]["code"] == "file_too_large"


def test_attachments_can_be_disabled(api, group, settings):
    settings.CHAT_ENABLE_ATTACHMENTS = False
    assert upload(api, group, "notes.txt", b"hi", "text/plain").json()["error"]["code"] == "feature_disabled"


def test_non_member_cannot_upload_or_download(api, group, mallory):
    assert upload(client_for(mallory), group, "n.txt", b"hi").status_code == 404
    att = upload(api, group, "n.txt", b"hi").json()["attachment"]
    assert client_for(mallory).get(att["url"]).status_code == 404


def test_pending_upload_is_private_until_sent(api, group, bob):
    att = upload(api, group, "n.txt", b"hello").json()["attachment"]
    assert client_for(bob).get(att["url"]).status_code == 404
    sent = api.post(
        f"{BASE}/conversations/{group.pk}/messages/", {"attachment_ids": [att["id"]]}, format="json"
    ).json()["message"]
    assert sent["attachments"][0]["id"] == att["id"]
    response = client_for(bob).get(att["url"])
    assert response.status_code == 200
    assert b"".join(response.streaming_content) == b"hello"
    assert response["X-Content-Type-Options"] == "nosniff"
    assert response["Content-Disposition"].startswith("attachment;")
    assert "sandbox" in response["Content-Security-Policy"]


def test_cannot_attach_someone_elses_upload(api, group, bob):
    att = upload(api, group, "n.txt", b"mine").json()["attachment"]
    response = client_for(bob).post(
        f"{BASE}/conversations/{group.pk}/messages/", {"attachment_ids": [att["id"]]}, format="json"
    )
    assert response.json()["error"]["code"] == "invalid_attachments"
    assert Attachment.objects.get(pk=att["id"]).message_id is None


def test_attachment_cannot_be_reused_in_another_conversation(api, group, direct):
    att = upload(api, group, "n.txt", b"mine").json()["attachment"]
    response = api.post(
        f"{BASE}/conversations/{direct.pk}/messages/", {"attachment_ids": [att["id"]]}, format="json"
    )
    assert response.status_code == 400


def test_failed_send_rolls_back_sequence(api, group):
    response = api.post(
        f"{BASE}/conversations/{group.pk}/messages/",
        {"body": "x", "attachment_ids": ["00000000-0000-0000-0000-000000000000"]},
        format="json",
    )
    assert response.status_code == 400
    group.refresh_from_db()
    assert group.last_seq == 0


def test_discard_pending_and_delete_message_removes_files(api, group, django_capture_on_commit_callbacks):
    att = upload(api, group, "n.txt", b"bye").json()["attachment"]
    stored = Attachment.objects.get(pk=att["id"])
    storage, name = stored.file.storage, stored.file.name
    with django_capture_on_commit_callbacks(execute=True):
        assert api.delete(f"{BASE}/attachments/{att['id']}/").status_code == 204
    assert not storage.exists(name)
    sent = upload(api, group, "m.txt", b"bye").json()["attachment"]
    message = api.post(
        f"{BASE}/conversations/{group.pk}/messages/", {"attachment_ids": [sent["id"]]}, format="json"
    ).json()["message"]
    name = Attachment.objects.get(pk=sent["id"]).file.name
    with django_capture_on_commit_callbacks(execute=True):
        api.delete(f"{BASE}/messages/{message['id']}/")
    assert not storage.exists(name)


def test_purge_stale_uploads(api, group):
    from datetime import timedelta

    from django.core.management import call_command
    from django.utils import timezone

    att = upload(api, group, "n.txt", b"old").json()["attachment"]
    Attachment.objects.filter(pk=att["id"]).update(created_at=timezone.now() - timedelta(days=2))
    call_command("chat_purge_uploads")
    assert not Attachment.objects.filter(pk=att["id"]).exists()
