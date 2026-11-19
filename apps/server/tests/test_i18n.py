"""The server answers in the language the SPA asks for (Accept-Language)."""

from rest_framework.test import APIClient

from accounts.models import User


def login(client, **headers):
    payload = {"identifier": "nora", "password": "wrong"}
    return client.post("/api/auth/login/", payload, format="json", **headers).json()["error"]


def test_auth_errors_follow_accept_language(db):
    User.objects.create_user(username="nora", password="Very-secret-42")
    assert login(APIClient())["message"] == "Incorrect username or password."
    assert login(APIClient(), HTTP_ACCEPT_LANGUAGE="fa")["message"] == "نام کاربری یا رمز اشتباه است."


def test_chat_errors_follow_accept_language(db):
    user = User.objects.create_user(username="nora", password="Very-secret-42")
    client = APIClient()
    client.force_authenticate(user)
    english = client.get("/api/chat/v1/conversations/00000000-0000-0000-0000-000000000000/")
    persian = client.get("/api/chat/v1/conversations/00000000-0000-0000-0000-000000000000/", HTTP_ACCEPT_LANGUAGE="fa")
    assert english.status_code == persian.status_code == 404
    assert english.json()["error"]["message"] == "Conversation not found."
    assert persian.json()["error"]["message"] == "گفت‌وگو پیدا نشد."
