import uuid

import pytest

from django_realtime_chat.models import Conversation, Membership
from django_realtime_chat.services import conversations as svc

from .conftest import client_for, make_user

BASE = "/api/chat/v1"


def test_requires_authentication(db):
    from rest_framework.test import APIClient

    response = APIClient().get(f"{BASE}/conversations/")
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "not_authenticated"


def test_direct_conversation_is_reused(api, alice, bob):
    first = api.post(f"{BASE}/conversations/", {"kind": "direct", "user_id": bob.pk}, format="json")
    second = api.post(f"{BASE}/conversations/", {"kind": "direct", "user_id": bob.pk}, format="json")
    assert first.status_code == 201 and first.json()["created"] is True
    assert second.status_code == 200 and second.json()["created"] is False
    assert first.json()["conversation"]["id"] == second.json()["conversation"]["id"]
    # Started from the other side resolves to the same conversation as well.
    reverse = client_for(bob).post(
        f"{BASE}/conversations/", {"kind": "direct", "user_id": alice.pk}, format="json"
    )
    assert reverse.json()["conversation"]["id"] == first.json()["conversation"]["id"]
    assert Conversation.objects.filter(kind="direct").count() == 1


def test_direct_title_is_the_peer_name(api, bob):
    data = api.post(f"{BASE}/conversations/", {"kind": "direct", "user_id": bob.pk}, format="json").json()
    assert data["conversation"]["title"] == "Bob"
    assert data["conversation"]["peer"]["username"] == "bob"
    assert "email" not in data["conversation"]["peer"]


def test_cannot_start_direct_with_self_or_unknown_user(api, alice):
    assert (
        api.post(f"{BASE}/conversations/", {"kind": "direct", "user_id": alice.pk}, format="json").status_code
        == 400
    )
    assert (
        api.post(f"{BASE}/conversations/", {"kind": "direct", "user_id": 999999}, format="json").status_code
        == 400
    )


def test_concurrent_direct_creation_race_returns_existing(alice, bob, monkeypatch):
    conv, created = svc.start_direct(alice, bob.pk)
    # Simulate the losing side of a race: the existence check misses, the insert collides.
    real_filter = Conversation.objects.filter
    calls = {"n": 0}

    def flaky_filter(*args, **kwargs):
        if "direct_key" in kwargs and calls["n"] == 0:
            calls["n"] += 1
            return Conversation.objects.none()
        return real_filter(*args, **kwargs)

    monkeypatch.setattr(Conversation.objects, "filter", flaky_filter)
    again, created_again = svc.start_direct(bob, alice.pk)
    assert created and not created_again
    assert again.pk == conv.pk


def test_group_creation_validates_input(api, bob):
    assert (
        api.post(
            f"{BASE}/conversations/", {"kind": "group", "title": "", "member_ids": [bob.pk]}, format="json"
        ).status_code
        == 400
    )
    assert (
        api.post(
            f"{BASE}/conversations/",
            {"kind": "group", "title": "x" * 200, "member_ids": [bob.pk]},
            format="json",
        ).status_code
        == 400
    )
    assert (
        api.post(
            f"{BASE}/conversations/", {"kind": "group", "title": "T", "member_ids": "nope"}, format="json"
        ).status_code
        == 400
    )
    ok = api.post(
        f"{BASE}/conversations/", {"kind": "group", "title": "Team", "member_ids": [bob.pk]}, format="json"
    )
    assert ok.status_code == 201
    body = ok.json()["conversation"]
    assert body["my_role"] == "owner" and body["member_count"] == 2


def test_groups_can_be_disabled(api, bob, settings):
    settings.CHAT_ENABLE_GROUPS = False
    response = api.post(
        f"{BASE}/conversations/", {"kind": "group", "title": "T", "member_ids": [bob.pk]}, format="json"
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "feature_disabled"


def test_list_is_isolated_to_members(group, direct, mallory):
    response = client_for(mallory).get(f"{BASE}/conversations/")
    assert response.json()["results"] == []
    # Non-members get 404 for existing conversations: existence is not revealed.
    assert client_for(mallory).get(f"{BASE}/conversations/{group.pk}/").status_code == 404
    assert client_for(mallory).get(f"{BASE}/conversations/{uuid.uuid4()}/").status_code == 404


def test_list_orders_by_activity_and_paginates(alice, bob, api):
    from django_realtime_chat.services.messages import send_message

    convs = [svc.create_group(alice, title=f"G{i}", member_ids=[bob.pk]) for i in range(5)]
    send_message(bob, convs[0].pk, body="bump")
    first = api.get(f"{BASE}/conversations/?limit=2").json()
    assert first["results"][0]["id"] == str(convs[0].pk)
    assert first["has_more"] is True
    second = api.get(f"{BASE}/conversations/?limit=2&before={first['next_cursor']}").json()
    ids = [c["id"] for c in first["results"] + second["results"]]
    assert len(ids) == len(set(ids)) == 4


def test_unread_count_and_read_marker(group, alice, bob, api):
    from django_realtime_chat.services.messages import send_message

    for i in range(3):
        send_message(bob, group.pk, body=f"m{i}")
    send_message(alice, group.pk, body="mine")
    conv = api.get(f"{BASE}/conversations/{group.pk}/").json()["conversation"]
    # Alice's own message marks everything before it as read.
    assert conv["unread_count"] == 0
    bob_view = client_for(bob).get(f"{BASE}/conversations/{group.pk}/").json()["conversation"]
    assert bob_view["unread_count"] == 1
    read = client_for(bob).post(f"{BASE}/conversations/{group.pk}/read/", {"seq": 4}, format="json")
    assert read.json()["last_read_seq"] == 4
    # Monotonic: an older seq does not move the marker back.
    stale = client_for(bob).post(f"{BASE}/conversations/{group.pk}/read/", {"seq": 1}, format="json")
    assert stale.json()["last_read_seq"] == 4
    assert (
        client_for(bob).get(f"{BASE}/conversations/{group.pk}/").json()["conversation"]["unread_count"] == 0
    )


def test_only_admins_edit_and_add_members(group, bob, mallory, api):
    url = f"{BASE}/conversations/{group.pk}/"
    assert client_for(bob).patch(url, {"title": "Hijack"}, format="json").status_code == 403
    assert (
        api.patch(url, {"title": "Design team"}, format="json").json()["conversation"]["title"]
        == "Design team"
    )
    members_url = f"{BASE}/conversations/{group.pk}/members/"
    assert client_for(bob).post(members_url, {"user_ids": [mallory.pk]}, format="json").status_code == 403
    added = api.post(members_url, {"user_ids": [mallory.pk]}, format="json")
    assert added.status_code == 201 and added.json()["added_user_ids"] == [mallory.pk]


def test_member_removal_rules_and_owner_transfer(group, alice, bob, carol):
    url = f"{BASE}/conversations/{group.pk}/members/"
    # Members cannot remove others.
    assert client_for(bob).delete(f"{url}{carol.pk}/").status_code == 403
    # Owner promotes Bob to admin; admins cannot remove the owner.
    assert client_for(alice).patch(f"{url}{bob.pk}/", {"role": "admin"}, format="json").status_code == 200
    assert client_for(bob).delete(f"{url}{alice.pk}/").status_code == 403
    assert client_for(bob).delete(f"{url}{carol.pk}/").status_code == 204
    # Removed member loses access immediately.
    assert client_for(carol).get(f"{BASE}/conversations/{group.pk}/messages/").status_code == 404
    # Owner leaves: the admin becomes owner.
    assert client_for(alice).delete(f"{url}{alice.pk}/").status_code == 204
    assert Membership.objects.get(conversation=group, user=bob).role == "owner"


def test_rejoining_member_starts_at_current_position(group, alice, carol):
    from django_realtime_chat.services.messages import send_message

    svc.remove_member(alice, group.pk, carol.pk)
    send_message(alice, group.pk, body="while away")
    svc.add_members(alice, group.pk, [carol.pk])
    conv = client_for(carol).get(f"{BASE}/conversations/{group.pk}/").json()["conversation"]
    assert conv["unread_count"] == 0


def test_direct_conversations_have_no_member_management(direct, alice, carol):
    response = client_for(alice).post(
        f"{BASE}/conversations/{direct.pk}/members/", {"user_ids": [carol.pk]}, format="json"
    )
    assert response.status_code == 403


def test_custom_policy_can_restrict_discovery(api, bob, settings):
    settings.CHAT_POLICY = "tests.policies.NoBobPolicy"
    response = api.post(f"{BASE}/conversations/", {"kind": "direct", "user_id": bob.pk}, format="json")
    assert response.status_code == 400
    assert api.get(f"{BASE}/users/search/?q=bob").json()["results"] == []


def test_user_search_does_not_leak_private_fields(api, bob):
    make_user("bobby", email="bobby@example.com")
    results = api.get(f"{BASE}/users/search/?q=bob").json()["results"]
    assert {r["username"] for r in results} == {"bob", "bobby"}
    assert all("email" not in r for r in results)


def test_empty_user_search_suggests_contacts_only(api, direct, carol):
    results = api.get(f"{BASE}/users/search/").json()["results"]
    assert [r["username"] for r in results] == ["bob"]


def test_config_endpoint_reports_limits(api, settings):
    settings.CHAT_MAX_MESSAGE_LENGTH = 1234
    data = api.get(f"{BASE}/config/").json()
    assert data["limits"]["max_message_length"] == 1234
    assert data["features"]["groups"] is True
    assert data["user"]["username"] == "alice"


@pytest.mark.parametrize("bad", ["not-a-uuid"])
def test_malformed_member_ids_are_404(api, group, bad):
    assert api.delete(f"{BASE}/conversations/{group.pk}/members/{bad}/").status_code == 404


@pytest.mark.parametrize("bad", ["abc", "99999999999999999999999", "-1.5", "", " "])
def test_malformed_user_ids_are_rejected_not_500(api, group, bad):
    assert (
        api.post(f"{BASE}/conversations/", {"kind": "direct", "user_id": bad}, format="json").status_code
        == 400
    )
    assert (
        api.post(
            f"{BASE}/conversations/", {"kind": "group", "title": "t", "member_ids": [bad]}, format="json"
        ).status_code
        == 400
    )
    assert (
        api.post(
            f"{BASE}/conversations/{group.pk}/members/", {"user_ids": [bad, {"x": 1}]}, format="json"
        ).status_code
        == 400
    )
    if bad.strip():
        assert api.get(f"{BASE}/users/{bad}/").status_code == 404
        assert api.delete(f"{BASE}/conversations/{group.pk}/members/{bad}/").status_code == 404
        assert (
            api.patch(
                f"{BASE}/conversations/{group.pk}/members/{bad}/", {"role": "admin"}, format="json"
            ).status_code
            == 404
        )
