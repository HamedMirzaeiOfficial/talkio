"""Voice notes, thumbnails, stickers and emoji reactions."""

import io
import json

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from django_realtime_chat.emoji import is_emoji
from django_realtime_chat.models import Attachment, Message, Sticker, StickerPack
from django_realtime_chat.services import messages as msg_svc

from .conftest import client_for, png_bytes

BASE = "/api/chat/v1"
WEBM = b"\x1a\x45\xdf\xa3" + b"\x00" * 60  # EBML header: a WebM container


def upload(client, conv, name, content, declared, **extra):
    file = SimpleUploadedFile(name, content, content_type=declared)
    return client.post(
        f"{BASE}/attachments/", {"conversation_id": str(conv.pk), "file": file, **extra}, format="multipart"
    )


# --- voice ----------------------------------------------------------------------------


def test_voice_note_upload_and_send(api, group, bob):
    waveform = [0, 10, 55, 100, 30]
    data = upload(
        api,
        group,
        "voice.webm",
        WEBM,
        "audio/webm;codecs=opus",
        voice="1",
        duration="3.456",
        waveform=json.dumps(waveform),
    )
    assert data.status_code == 201, data.json()
    att = data.json()["attachment"]
    assert att["content_type"] == "audio/webm"  # container + declared audio, not video/webm
    assert att["is_voice"] and att["duration"] == 3.46 and att["waveform"] == waveform
    message = api.post(
        f"{BASE}/conversations/{group.pk}/messages/", {"attachment_ids": [att["id"]]}, format="json"
    ).json()["message"]
    assert message["kind"] == "voice"
    response = client_for(bob).get(att["url"])
    assert response["Content-Disposition"].startswith("inline;")


def test_webm_without_audio_declaration_is_video(api, group):
    att = upload(api, group, "clip.webm", WEBM, "video/webm").json()["attachment"]
    assert att["content_type"] == "video/webm" and att["is_voice"] is False


@pytest.mark.parametrize(
    "extra,code",
    [
        ({"duration": "0", "waveform": "[]"}, "voice_too_long"),
        ({"duration": "601", "waveform": "[]"}, "voice_too_long"),
        ({"duration": "abc", "waveform": "[]"}, "invalid_voice"),
        ({"duration": "2", "waveform": "[101]"}, "invalid_voice"),
        ({"duration": "2", "waveform": json.dumps(list(range(129)))}, "invalid_voice"),
        ({"duration": "2", "waveform": "not json"}, "invalid_voice"),
    ],
)
def test_voice_metadata_is_validated(api, group, extra, code):
    response = upload(api, group, "v.webm", WEBM, "audio/webm", voice="true", **extra)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == code


def test_voice_requires_audio_and_can_be_disabled(api, group, settings):
    bad = upload(api, group, "v.png", png_bytes(), "audio/webm", voice="1", duration="2", waveform="[]")
    assert bad.json()["error"]["code"] == "invalid_voice"
    settings.CHAT_ENABLE_VOICE = False
    off = upload(api, group, "v.webm", WEBM, "audio/webm", voice="1", duration="2", waveform="[]")
    assert off.json()["error"]["code"] == "feature_disabled"


# --- thumbnails ------------------------------------------------------------------------


def test_large_images_get_a_webp_thumbnail(api, group, bob):
    att = upload(api, group, "big.png", png_bytes((1600, 900)), "image/png").json()["attachment"]
    assert att["thumbnail_url"].endswith("?variant=thumb")
    api.post(f"{BASE}/conversations/{group.pk}/messages/", {"attachment_ids": [att["id"]]}, format="json")
    response = client_for(bob).get(att["thumbnail_url"])
    assert response.status_code == 200 and response["Content-Type"] == "image/webp"
    from PIL import Image

    image = Image.open(io.BytesIO(b"".join(response.streaming_content)))
    assert max(image.size) == 480
    small = upload(api, group, "small.png", png_bytes((40, 40)), "image/png").json()["attachment"]
    assert small["thumbnail_url"] is None


def test_thumbnail_is_authorized_like_the_file(api, group, mallory):
    att = upload(api, group, "big.png", png_bytes((1000, 1000)), "image/png").json()["attachment"]
    assert client_for(mallory).get(att["thumbnail_url"]).status_code == 404


# --- stickers ----------------------------------------------------------------------------


@pytest.fixture
def sticker(db):
    pack = StickerPack.objects.create(name="Basics")
    item = Sticker(pack=pack, emoji="😀", content_type="image/png", width=8, height=8)
    item.file.save("s.png", SimpleUploadedFile("s.png", png_bytes((8, 8))), save=False)
    item.save()
    return item


def test_list_and_send_sticker(api, group, bob, sticker):
    packs = api.get(f"{BASE}/stickers/").json()["results"]
    assert packs[0]["name"] == "Basics" and packs[0]["stickers"][0]["emoji"] == "😀"
    sent = api.post(
        f"{BASE}/conversations/{group.pk}/messages/", {"sticker_id": str(sticker.pk)}, format="json"
    )
    assert sent.status_code == 201
    message = sent.json()["message"]
    assert message["kind"] == "sticker" and message["sticker"]["id"] == str(sticker.pk)
    file = client_for(bob).get(message["sticker"]["url"])
    assert file.status_code == 200 and "immutable" in file["Cache-Control"]


def test_sticker_rules(api, group, sticker, settings):
    url = f"{BASE}/conversations/{group.pk}/messages/"
    mixed = api.post(url, {"sticker_id": str(sticker.pk), "body": "hi"}, format="json")
    assert mixed.json()["error"]["code"] == "invalid_sticker"
    unknown = api.post(url, {"sticker_id": "00000000-0000-0000-0000-000000000000"}, format="json")
    assert unknown.json()["error"]["code"] == "invalid_sticker"
    sticker.pack.is_active = False
    sticker.pack.save()
    assert (
        api.post(url, {"sticker_id": str(sticker.pk)}, format="json").json()["error"]["code"]
        == "invalid_sticker"
    )
    assert api.get(f"{BASE}/stickers/").json()["results"] == []
    settings.CHAT_ENABLE_STICKERS = False
    assert (
        api.post(url, {"sticker_id": str(sticker.pk)}, format="json").json()["error"]["code"]
        == "feature_disabled"
    )


def test_forwarding_a_sticker_keeps_it(alice, group, direct, sticker):
    original, _ = msg_svc.send_message(alice, group.pk, sticker_id=sticker.pk)
    forwarded, _ = msg_svc.forward_message(alice, original.pk, direct.pk)
    assert Message.objects.get(pk=forwarded.pk).sticker_id == sticker.pk


def test_sticker_admin_validates_uploads(db):
    from django_realtime_chat.admin import StickerForm

    pack = StickerPack.objects.create(name="Admin")
    ok = StickerForm(
        data={"emoji": "🎉", "position": 0},
        files={"file": SimpleUploadedFile("a.png", png_bytes((64, 64)), "image/png")},
        instance=Sticker(pack=pack),
    )
    assert ok.is_valid(), ok.errors
    saved = ok.save()
    assert (saved.content_type, saved.width) == ("image/png", 64)
    huge = StickerForm(
        data={"emoji": "x", "position": 0},
        files={"file": SimpleUploadedFile("b.png", png_bytes((800, 800)), "image/png")},
        instance=Sticker(pack=pack),
    )
    assert not huge.is_valid()
    svg = StickerForm(
        data={"emoji": "x", "position": 0},
        files={"file": SimpleUploadedFile("c.svg", b"<svg/>", "image/svg+xml")},
        instance=Sticker(pack=pack),
    )
    assert not svg.is_valid()


# --- emoji reactions -----------------------------------------------------------------------


@pytest.mark.parametrize("value", ["👍", "❤️", "👍🏽", "👨‍👩‍👧", "🇮🇷", "1️⃣", "🏴󠁧󠁢󠁳󠁣󠁴󠁿", "🫠"])
def test_emoji_accepted(value):
    assert is_emoji(value)


@pytest.mark.parametrize("value", ["", "a", "<b>", "👍 ", "1", "😀text", "‍", "x" * 40, None])
def test_non_emoji_rejected(value):
    assert not is_emoji(value)


def test_any_emoji_reaction_by_default_and_list_can_restrict(alice, group, settings):
    message, _ = msg_svc.send_message(alice, group.pk, body="react")
    assert msg_svc.toggle_reaction(alice, message.pk, "🫠")["active"] is True
    settings.CHAT_ALLOWED_REACTIONS = ["👍"]
    from django_realtime_chat.errors import ValidationFailed

    with pytest.raises(ValidationFailed):
        msg_svc.toggle_reaction(alice, message.pk, "🫠")


def test_config_reports_media_features(api):
    data = api.get(f"{BASE}/config/").json()
    assert data["features"]["stickers"] and data["features"]["voice"]
    assert data["allowed_reactions"] is None and "👍" in data["quick_reactions"]
    assert data["limits"]["max_voice_duration"] == 600


def test_deleting_message_removes_thumbnail(api, group, django_capture_on_commit_callbacks):
    att = upload(api, group, "big.png", png_bytes((1200, 800)), "image/png").json()["attachment"]
    stored = Attachment.objects.get(pk=att["id"])
    storage, thumb = stored.thumbnail.storage, stored.thumbnail.name
    message = api.post(
        f"{BASE}/conversations/{group.pk}/messages/", {"attachment_ids": [att["id"]]}, format="json"
    ).json()["message"]
    with django_capture_on_commit_callbacks(execute=True):
        api.delete(f"{BASE}/messages/{message['id']}/")
    assert not storage.exists(thumb)
