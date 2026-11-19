from rest_framework.test import APIClient

from accounts.models import User


def csrf_client():
    client = APIClient(enforce_csrf_checks=True)
    token = client.get("/api/auth/session/").json()["csrf_token"]
    client.credentials(HTTP_X_CSRFTOKEN=token)
    return client


def test_session_bootstrap_for_anonymous(db):
    data = APIClient().get("/api/auth/session/").json()
    assert data["user"] is None and data["csrf_token"]
    assert data["providers"] == []


def test_register_login_logout_flow(db):
    client = csrf_client()
    created = client.post(
        "/api/auth/register/",
        {"username": "nora", "display_name": "Nora Lind", "password": "Very-secret-42", "email": "nora@example.com"},
        format="json",
    )
    assert created.status_code == 201
    assert created.json()["user"]["display_name"] == "Nora Lind"
    assert client.get("/api/auth/me/").json()["user"]["username"] == "nora"
    client.credentials(HTTP_X_CSRFTOKEN=created.json()["csrf_token"])
    assert client.post("/api/auth/logout/").status_code == 204
    assert client.get("/api/auth/me/").status_code == 403
    assert (
        csrf_client()
        .post("/api/auth/login/", {"identifier": "nora@example.com", "password": "Very-secret-42"}, format="json")
        .status_code
        == 200
    )
    assert (
        csrf_client().post("/api/auth/login/", {"identifier": "nora", "password": "wrong"}, format="json").status_code
        == 401
    )


def test_login_and_register_require_csrf(db, alice):
    client = APIClient(enforce_csrf_checks=True)
    assert (
        client.post(
            "/api/auth/login/", {"identifier": "alice", "password": "Correct-horse-9"}, format="json"
        ).status_code
        == 403
    )
    assert client.post("/api/auth/register/", {"username": "x"}, format="json").status_code == 403


def test_registration_validation(db, alice):
    client = csrf_client()
    cases = [
        ({"username": "a", "display_name": "A", "password": "Very-secret-42"}, "invalid_username"),
        ({"username": "alice", "display_name": "A", "password": "Very-secret-42"}, "username_taken"),
        ({"username": "ALICE", "display_name": "A", "password": "Very-secret-42"}, "username_taken"),
        ({"username": "newbie", "display_name": "", "password": "Very-secret-42"}, "invalid_display_name"),
        ({"username": "newbie", "display_name": "N", "password": "123"}, "weak_password"),
        (
            {"username": "newbie", "display_name": "N", "password": "Very-secret-42", "email": "alice@example.com"},
            "email_taken",
        ),
    ]
    for payload, code in cases:
        response = client.post("/api/auth/register/", payload, format="json")
        assert response.json()["error"]["code"] == code, payload


def test_profile_update_and_password_change(alice):
    client = APIClient()
    client.force_login(alice)
    updated = client.patch("/api/auth/me/", {"first_name": "Alicia", "last_name": "M"}, format="json").json()["user"]
    assert updated["display_name"] == "Alicia M"
    bad_avatar = client.patch("/api/auth/me/", {"avatar": _file("a.png", b"<svg></svg>")}, format="multipart")
    assert bad_avatar.json()["error"]["code"] == "invalid_avatar"
    assert (
        client.post(
            "/api/auth/me/password/", {"current_password": "nope", "new_password": "Another-pass-77"}, format="json"
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/auth/me/password/",
            {"current_password": "Correct-horse-9", "new_password": "Another-pass-77"},
            format="json",
        ).status_code
        == 204
    )
    alice.refresh_from_db()
    assert alice.check_password("Another-pass-77")
    # The session survives the password change.
    assert client.get("/api/auth/me/").status_code == 200


def test_avatar_upload(alice):
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (4, 4)).save(buffer, format="PNG")
    client = APIClient()
    client.force_login(alice)
    user = client.patch("/api/auth/me/", {"avatar": _file("me.png", buffer.getvalue())}, format="multipart").json()[
        "user"
    ]
    assert user["avatar_url"].startswith("/media/avatars/")


def test_demo_login_with_default_code(db, settings):
    settings.DEMO_AUTH_ENABLED = False
    client = csrf_client()
    assert client.post("/api/auth/login/", {"phone": "09121112233", "code": "1234"}, format="json").status_code == 400
    settings.DEMO_AUTH_ENABLED = True
    settings.DEMO_AUTH_CODE = "1234"
    assert client.post("/api/auth/login/", {"phone": "09121112233", "code": "0000"}, format="json").status_code == 401
    assert client.post("/api/auth/login/", {"phone": "12ab", "code": "1234"}, format="json").status_code == 401
    response = client.post("/api/auth/login/", {"phone": "09121112233", "code": "1234"}, format="json")
    assert response.status_code == 200
    user = response.json()["user"]
    assert user["display_name"].startswith("Guest ") and "09121112233" not in str(user)
    # Same last digits, different phone: no username collision.
    other = csrf_client().post("/api/auth/login/", {"phone": "09991112233", "code": "1234"}, format="json")
    assert other.status_code == 200
    # Logging in again reuses the account.
    csrf_client().post("/api/auth/login/", {"phone": "09121112233", "code": "1234"}, format="json")
    assert User.objects.filter(phone="09121112233").count() == 1


def test_demo_login_is_never_enabled_without_debug():
    import importlib
    import os

    from core import settings as project_settings

    old = {k: os.environ.get(k) for k in ("DEBUG", "DJANGO_SECRET_KEY", "DEMO_AUTH_ENABLED")}
    os.environ.update({"DEBUG": "0", "DJANGO_SECRET_KEY": "x" * 50, "DEMO_AUTH_ENABLED": "1"})
    try:
        assert importlib.reload(project_settings).DEMO_AUTH_ENABLED is False
    finally:
        for key, value in old.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        importlib.reload(project_settings)


def _file(name, content):
    from django.core.files.uploadedfile import SimpleUploadedFile

    return SimpleUploadedFile(name, content, content_type="image/png")
