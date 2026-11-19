import pytest

from django_realtime_chat.models import Message
from django_realtime_chat.services import messages as svc

from .conftest import client_for

BASE = "/api/chat/v1"


def post(client, conv, **data):
    return client.post(f"{BASE}/conversations/{conv.pk}/messages/", data, format="json")


def test_send_assigns_sequential_seq(api, group):
    seqs = [post(api, group, body=f"m{i}", client_id=f"c{i}").json()["message"]["seq"] for i in range(3)]
    assert seqs == [1, 2, 3]
    group.refresh_from_db()
    assert group.last_seq == 3


def test_send_is_idempotent_by_client_id(api, group):
    first = post(api, group, body="hello", client_id="abc-1")
    retry = post(api, group, body="hello", client_id="abc-1")
    assert first.status_code == 201
    assert retry.status_code == 200 and retry.json()["deduplicated"] is True
    assert retry.json()["message"]["id"] == first.json()["message"]["id"]
    assert Message.objects.filter(conversation=group).count() == 1
    group.refresh_from_db()
    assert group.last_seq == 1  # a retry does not consume a sequence number


def test_same_client_id_in_another_conversation_is_independent(api, group, direct):
    a = post(api, group, body="x", client_id="same")
    b = post(api, direct, body="x", client_id="same")
    assert a.json()["message"]["id"] != b.json()["message"]["id"]


def test_lost_race_returns_the_winner(alice, group, monkeypatch):
    winner, _ = svc.send_message(alice, group.pk, body="once", client_id="race")
    real = svc.message_queryset
    calls = {"n": 0}

    def miss_first_lookup():
        qs = real()
        calls["n"] += 1
        return qs.none() if calls["n"] == 1 else qs

    monkeypatch.setattr(svc, "message_queryset", miss_first_lookup)
    again, created = svc.send_message(alice, group.pk, body="once", client_id="race")
    assert not created and again.pk == winner.pk
    group.refresh_from_db()
    assert group.last_seq == 1  # the losing transaction's seq increment was rolled back


@pytest.mark.parametrize(
    "payload,code",
    [
        ({"body": ""}, "empty_message"),
        ({"body": "   "}, "empty_message"),
        ({"body": "x" * 4001}, "message_too_long"),
        ({"body": 123}, "invalid_body"),
        ({"body": "ok", "client_id": "has spaces"}, "invalid_client_id"),
        ({"body": "ok", "client_id": "x" * 65}, "invalid_client_id"),
    ],
)
def test_invalid_messages_are_rejected(api, group, payload, code):
    response = post(api, group, **payload)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == code


def test_message_length_is_configurable(api, group, settings):
    settings.CHAT_MAX_MESSAGE_LENGTH = 5
    assert post(api, group, body="123456").status_code == 400
    assert post(api, group, body="12345").status_code == 201


def test_body_is_stored_as_plain_text_and_bidi_overrides_removed(api, group):
    body = "<script>alert(1)</script> ‮evil"
    message = post(api, group, body=body).json()["message"]
    assert message["body"] == "<script>alert(1)</script> evil"


def test_non_members_cannot_read_or_write(group, mallory):
    outsider = client_for(mallory)
    assert outsider.get(f"{BASE}/conversations/{group.pk}/messages/").status_code == 404
    assert post(outsider, group, body="hi").status_code == 404


def test_history_pagination_before_and_after(alice, group, api):
    for i in range(7):
        svc.send_message(alice, group.pk, body=f"m{i}")
    page = api.get(f"{BASE}/conversations/{group.pk}/messages/?limit=3").json()
    assert [m["seq"] for m in page["results"]] == [5, 6, 7]
    assert page["has_more"] and page["next_cursor"] == "5"
    older = api.get(f"{BASE}/conversations/{group.pk}/messages/?limit=3&before=5").json()
    assert [m["seq"] for m in older["results"]] == [2, 3, 4]
    oldest = api.get(f"{BASE}/conversations/{group.pk}/messages/?limit=3&before=2").json()
    assert [m["seq"] for m in oldest["results"]] == [1] and oldest["has_more"] is False
    gap = api.get(f"{BASE}/conversations/{group.pk}/messages/?after=4&limit=2").json()
    assert [m["seq"] for m in gap["results"]] == [5, 6] and gap["next_cursor"] == "6"
    assert api.get(f"{BASE}/conversations/{group.pk}/messages/?before=x").status_code == 400
    assert api.get(f"{BASE}/conversations/{group.pk}/messages/?before=1&after=1").status_code == 400


def test_updated_since_returns_changed_messages(alice, group, api):
    from django.utils import timezone

    m1, _ = svc.send_message(alice, group.pk, body="one")
    svc.send_message(alice, group.pk, body="two")
    checkpoint = timezone.now()
    svc.edit_message(alice, m1.pk, "one (edited)")
    data = api.get(
        f"{BASE}/conversations/{group.pk}/messages/", {"updated_since": checkpoint.isoformat()}
    ).json()
    assert [m["body"] for m in data["results"]] == ["one (edited)"]


def test_reply_must_be_in_same_conversation(alice, group, direct, api):
    other, _ = svc.send_message(alice, direct.pk, body="elsewhere")
    assert post(api, group, body="re", reply_to_id=str(other.pk)).json()["error"]["code"] == "invalid_reply"
    target, _ = svc.send_message(alice, group.pk, body="original")
    reply = post(api, group, body="re", reply_to_id=str(target.pk)).json()["message"]
    assert reply["reply_to"]["id"] == str(target.pk) and reply["reply_to"]["body"] == "original"


def test_edit_rules(alice, bob, group, settings):
    message, _ = svc.send_message(alice, group.pk, body="draft")
    url = f"{BASE}/messages/{message.pk}/"
    assert client_for(bob).patch(url, {"body": "hacked"}, format="json").status_code == 403
    edited = client_for(alice).patch(url, {"body": "final"}, format="json").json()["message"]
    assert edited["body"] == "final" and edited["edited_at"] is not None
    settings.CHAT_EDIT_WINDOW = 1
    Message.objects.filter(pk=message.pk).update(created_at=message.created_at.replace(year=2000))
    assert (
        client_for(alice).patch(url, {"body": "late"}, format="json").json()["error"]["code"]
        == "edit_window_expired"
    )


def test_delete_is_a_tombstone(alice, bob, carol, group):
    message, _ = svc.send_message(bob, group.pk, body="secret")
    svc.toggle_reaction(alice, message.pk, "👍")
    url = f"{BASE}/messages/{message.pk}/"
    assert client_for(carol).delete(url).status_code == 403  # plain member
    deleted = client_for(alice).delete(url).json()["message"]  # group owner may moderate
    assert deleted["is_deleted"] and deleted["body"] == "" and deleted["reactions"] == []
    history = client_for(bob).get(f"{BASE}/conversations/{group.pk}/messages/").json()["results"]
    assert history[0]["is_deleted"] and history[0]["seq"] == 1
    assert client_for(bob).patch(url, {"body": "revive"}, format="json").status_code == 400


def test_admin_moderation_can_be_disabled(alice, bob, group, settings):
    settings.CHAT_DEFAULT_PERMISSIONS = {"admins_can_delete_messages": False}
    message, _ = svc.send_message(bob, group.pk, body="keep")
    assert client_for(alice).delete(f"{BASE}/messages/{message.pk}/").status_code == 403


def test_reactions_toggle_and_validate(alice, bob, group, mallory):
    message, _ = svc.send_message(alice, group.pk, body="react")
    url = f"{BASE}/messages/{message.pk}/reactions/"
    on = client_for(bob).post(url, {"emoji": "🔥"}, format="json").json()
    assert on["active"] and on["reactions"] == [{"emoji": "🔥", "count": 1, "user_ids": [bob.pk]}]
    off = client_for(bob).post(url, {"emoji": "🔥"}, format="json").json()
    assert not off["active"] and off["reactions"] == []
    assert client_for(bob).post(url, {"emoji": "<b>"}, format="json").status_code == 400
    assert client_for(mallory).post(url, {"emoji": "🔥"}, format="json").status_code == 404


def test_pin_toggle_and_pinned_listing(alice, group, api):
    message, _ = svc.send_message(alice, group.pk, body="pin me")
    assert api.post(f"{BASE}/messages/{message.pk}/pin/").json()["active"] is True
    pinned = api.get(f"{BASE}/conversations/{group.pk}/messages/?pinned=1").json()["results"]
    assert [m["id"] for m in pinned] == [str(message.pk)]
    assert api.post(f"{BASE}/messages/{message.pk}/pin/").json()["active"] is False


def test_forward_requires_membership_in_both(alice, bob, group, direct, mallory):
    source, _ = svc.send_message(bob, group.pk, body="fwd")
    ok = client_for(alice).post(
        f"{BASE}/messages/{source.pk}/forward/",
        {"conversation_id": str(direct.pk), "client_id": "f1"},
        format="json",
    )
    assert ok.status_code == 201
    assert ok.json()["message"]["forwarded_from"]["id"] == str(source.pk)
    retry = client_for(alice).post(
        f"{BASE}/messages/{source.pk}/forward/",
        {"conversation_id": str(direct.pk), "client_id": "f1"},
        format="json",
    )
    assert retry.status_code == 200
    denied = client_for(mallory).post(
        f"{BASE}/messages/{source.pk}/forward/", {"conversation_id": str(direct.pk)}, format="json"
    )
    assert denied.status_code == 404


def test_search_is_scoped_to_memberships(alice, bob, group, mallory, api):
    svc.send_message(bob, group.pk, body="the quarterly roadmap")
    deleted, _ = svc.send_message(bob, group.pk, body="roadmap draft")
    svc.delete_message(bob, deleted.pk)
    results = api.get(f"{BASE}/messages/search/?q=roadmap").json()["results"]
    assert [r["body"] for r in results] == ["the quarterly roadmap"]
    assert client_for(mallory).get(f"{BASE}/messages/search/?q=roadmap").json()["results"] == []
    assert api.get(f"{BASE}/messages/search/?q=r").status_code == 400


def test_http_write_rate_limit(api, group, settings):
    settings.CHAT_RATE_LIMITS = {"http_write": "2/m"}
    assert post(api, group, body="1").status_code == 201
    assert post(api, group, body="2").status_code == 201
    limited = post(api, group, body="3")
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "rate_limited"
    assert "Retry-After" in limited


@pytest.mark.django_db(transaction=True)
def test_concurrent_sends_get_unique_sequences(django_db_blocker):
    """Real concurrency; meaningful on PostgreSQL (SQLite serializes writers)."""
    import threading

    from django.db import connection

    if connection.vendor != "postgresql":
        pytest.skip("requires PostgreSQL")
    from django.contrib.auth import get_user_model

    from django_realtime_chat.services.conversations import create_group

    users = [get_user_model().objects.create_user(username=f"u{i}", password="x") for i in range(4)]
    conv = create_group(users[0], title="race", member_ids=[u.pk for u in users[1:]])
    errors = []

    def worker(user, n):
        try:
            for i in range(n):
                svc.send_message(user, conv.pk, body=f"{user.pk}-{i}", client_id=f"k{i % 3}-{user.pk}")
                svc.send_message(user, conv.pk, body="dup", client_id=f"dup-{user.pk}")
        except Exception as exc:  # pragma: no cover - reported below
            errors.append(exc)
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, args=(u, 6)) for u in users]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert not errors
    seqs = list(Message.objects.filter(conversation=conv).values_list("seq", flat=True).order_by("seq"))
    assert seqs == list(range(1, len(seqs) + 1))
    assert len(seqs) == len(users) * 4  # 3 distinct keys + 1 dup key per user
