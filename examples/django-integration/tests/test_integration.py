"""The package works in a project with the stock auth.User and a custom policy."""

import pytest
from django.contrib.auth.models import Group, User
from rest_framework.test import APIClient

BASE = "/api/chat/v1"


@pytest.fixture(autouse=True)
def _storage(settings, tmp_path):
    settings.STORAGES = {**settings.STORAGES, "chat_files": {"BACKEND": "django.core.files.storage.InMemoryStorage"}}


@pytest.fixture
def team(db):
    sales = Group.objects.create(name="sales")
    ann = User.objects.create_user("ann", password="pw", first_name="Ann")
    ben = User.objects.create_user("ben", password="pw", first_name="Ben")
    outsider = User.objects.create_user("zed", password="pw", first_name="Zed")
    ann.groups.add(sales)
    ben.groups.add(sales)
    return ann, ben, outsider


def client(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


def test_stock_user_model_and_session_auth(team):
    ann, ben, _ = team
    c = APIClient()
    assert c.login(username="ann", password="pw")
    response = c.post(f"{BASE}/conversations/", {"kind": "direct", "user_id": ben.pk}, format="json")
    # Real session auth enforces CSRF; the test client exempts it unless enforce_csrf_checks.
    assert response.status_code == 201
    assert response.json()["conversation"]["peer"]["username"] == "ben"


def test_policy_restricts_discovery_to_teammates(team):
    ann, _, outsider = team
    names = [u["username"] for u in client(ann).get(f"{BASE}/users/search/?q=e").json()["results"]]
    assert "ben" in names and "zed" not in names
    blocked = client(ann).post(f"{BASE}/conversations/", {"kind": "direct", "user_id": outsider.pk}, format="json")
    assert blocked.status_code == 400
    assert client(outsider).post(f"{BASE}/conversations/", {"kind": "group", "title": "x", "member_ids": []}, format="json").status_code == 403


def test_host_settings_are_applied(team):
    ann, ben, _ = team
    config = client(ann).get(f"{BASE}/config/").json()
    assert config["limits"]["max_message_length"] == 2000
    assert config["allowed_attachment_types"] == ["image/png", "image/jpeg", "application/pdf"]
    group = client(ann).post(f"{BASE}/conversations/", {"kind": "group", "title": "Deals", "member_ids": [ben.pk]}, format="json").json()
    # members_can_add_members=True: plain members may add teammates.
    carl = User.objects.create_user("carl", password="pw")
    carl.groups.add(Group.objects.get(name="sales"))
    added = client(ben).post(f"{BASE}/conversations/{group['conversation']['id']}/members/", {"user_ids": [carl.pk]}, format="json")
    assert added.status_code == 201


def test_system_checks_pass():
    from django.core.management import call_command

    call_command("check")
