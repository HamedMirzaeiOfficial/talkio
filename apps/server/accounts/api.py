"""Session authentication API for the standalone web app (``/api/auth/``).

This is application code, not part of the reusable chat package: host applications
bring their own authentication and the chat package only needs ``request.user``.
"""

from __future__ import annotations

import re
import secrets

from django.conf import settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.middleware.csrf import get_token
from django.urls import path
from django.utils.decorators import method_decorator
from django.utils.translation import gettext
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .models import User
from .utils import generate_username

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.]{3,30}$")
PHONE_RE = re.compile(r"^\d{8,11}$")
AVATAR_TYPES = {"image/jpeg", "image/png", "image/webp"}
BACKEND = "accounts.authentication.CustomModelBackend"


def error(code: str, message: str, status: int = 400, field: str | None = None) -> Response:
    payload = {"code": code, "message": message}
    if field:
        payload["field"] = field
    return Response({"error": payload}, status=status)


def user_payload(user: User) -> dict:
    from django_realtime_chat.users import get_user_adapter

    adapter = get_user_adapter()
    return {
        "id": user.pk,
        "username": adapter.handle(user),
        "display_name": adapter.display_name(user),
        "first_name": user.first_name or "",
        "last_name": user.last_name or "",
        "email": user.email or "",
        "avatar_url": adapter.avatar_url(user),
        "date_joined": user.date_joined.isoformat() if user.date_joined else None,
    }


def providers() -> list[dict]:
    available = []
    if settings.SOCIAL_AUTH_GITHUB_KEY:
        available.append({"id": "github", "name": "GitHub", "login_url": "/social-auth/login/github/"})
    if settings.SOCIAL_AUTH_GOOGLE_OAUTH2_KEY:
        available.append({"id": "google", "name": "Google", "login_url": "/social-auth/login/google-oauth2/"})
    return available


class AuthView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


@method_decorator(ensure_csrf_cookie, name="dispatch")
class SessionView(AuthView):
    """Bootstrap for the SPA: who am I, which login methods exist. Also sets the CSRF cookie."""

    throttle_classes: list = []

    def get(self, request):
        user = request.user if request.user.is_authenticated else None
        return Response(
            {
                "user": user_payload(user) if user else None,
                "csrf_token": get_token(request),
                "providers": providers(),
                "demo_auth": settings.DEMO_AUTH_ENABLED,
            }
        )


@method_decorator(csrf_protect, name="dispatch")
class LoginView(AuthView):
    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        if settings.DEMO_AUTH_ENABLED and "code" in data:
            # Development-only: any phone number with the configured demo code (default 1234).
            phone = str(data.get("phone", "")).strip()
            code = str(data.get("code", "")).strip()
            if not PHONE_RE.match(phone) or not secrets.compare_digest(code, settings.DEMO_AUTH_CODE):
                return error("invalid_demo_credentials", gettext("Enter a valid phone number and the demo code."), 401)
            user = User.objects.filter(phone=phone).first()
            if user is None:
                # Random username (never the phone number) and a neutral display name.
                user = User.objects.create_user(
                    phone=phone,
                    username=generate_username(),
                    first_name="Guest",
                    last_name=generate_username(4).upper(),
                )
        else:
            identifier = str(data.get("identifier", "")).strip()
            password = data.get("password") or ""
            if not identifier or not password:
                return error("invalid_credentials", gettext("Enter your username or email and password."))
            user = authenticate(request, username=identifier, password=password)
            if user is None or not user.is_active:
                return error("invalid_credentials", gettext("Incorrect username or password."), 401)
        login(request, user, backend=BACKEND)
        return Response({"user": user_payload(user), "csrf_token": get_token(request)})


@method_decorator(csrf_protect, name="dispatch")
class RegisterView(AuthView):
    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        username = str(data.get("username", "")).strip()
        display_name = str(data.get("display_name", "")).strip()
        email = str(data.get("email", "")).strip() or None
        password = data.get("password") or ""
        if not USERNAME_RE.match(username):
            return error(
                "invalid_username", gettext("Use 3-30 letters, numbers, dots or underscores."), field="username"
            )
        if not display_name or len(display_name) > 60:
            return error("invalid_display_name", gettext("Enter a name up to 60 characters."), field="display_name")
        if email and ("@" not in email or len(email) > 254):
            return error("invalid_email", gettext("Enter a valid email address."), field="email")
        if User.objects.filter(username__iexact=username).exists():
            return error("username_taken", gettext("This username is taken."), 409, field="username")
        if email and User.objects.filter(email__iexact=email).exists():
            return error("email_taken", gettext("An account with this email already exists."), 409, field="email")
        first, _, last = display_name.partition(" ")
        candidate = User(username=username, email=email, first_name=first, last_name=last)
        try:
            validate_password(password, user=candidate)
        except ValidationError as exc:
            return error("weak_password", " ".join(exc.messages), field="password")
        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    username=username, email=email, password=password, first_name=first, last_name=last
                )
        except IntegrityError:
            return error("username_taken", gettext("This username is taken."), 409, field="username")
        login(request, user, backend=BACKEND)
        return Response({"user": user_payload(user), "csrf_token": get_token(request)}, status=201)


class LogoutView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        logout(request)
        return Response(status=204)


class MeView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get(self, request):
        return Response({"user": user_payload(request.user)})

    def patch(self, request):
        user: User = request.user
        data = request.data
        limits = {"first_name": 30, "last_name": 50, "email": 254}
        for field, limit in limits.items():
            if field in data:
                value = str(data.get(field) or "").strip()
                if len(value) > limit:
                    return error("invalid_profile", gettext("%(field)s is too long.") % {"field": field}, field=field)
                if field == "email" and value:
                    if "@" not in value:
                        return error("invalid_email", gettext("Enter a valid email address."), field="email")
                    if User.objects.filter(email__iexact=value).exclude(pk=user.pk).exists():
                        return error("email_taken", gettext("This email is already in use."), 409, field="email")
                setattr(user, field, value or (None if field == "email" else ""))
        if "username" in data:
            username = str(data.get("username") or "").strip()
            if not USERNAME_RE.match(username):
                return error(
                    "invalid_username", gettext("Use 3-30 letters, numbers, dots or underscores."), field="username"
                )
            if User.objects.filter(username__iexact=username).exclude(pk=user.pk).exists():
                return error("username_taken", gettext("This username is taken."), 409, field="username")
            user.username = username
        avatar = request.FILES.get("avatar")
        if avatar is not None:
            from django_realtime_chat.files import detect_content_type, image_dimensions

            head = avatar.read(64)
            avatar.seek(0)
            if avatar.size > 5 * 1024 * 1024 or detect_content_type(head) not in AVATAR_TYPES:
                return error("invalid_avatar", gettext("Avatars must be JPEG, PNG or WebP under 5 MB."), field="avatar")
            try:
                image_dimensions(avatar)
            except ValueError:
                return error("invalid_avatar", gettext("The avatar is not a valid image."), field="avatar")
            user.avatar = avatar
        elif data.get("remove_avatar") in (True, "true", "1"):
            user.avatar = None
        user.save()
        return Response({"user": user_payload(user)})


class PasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        current = request.data.get("current_password") or ""
        new = request.data.get("new_password") or ""
        if not request.user.check_password(current):
            return error("invalid_password", gettext("Your current password is incorrect."), field="current_password")
        try:
            validate_password(new, user=request.user)
        except ValidationError as exc:
            return error("weak_password", " ".join(exc.messages), field="new_password")
        request.user.set_password(new)
        request.user.save(update_fields=["password"])
        update_session_auth_hash(request, request.user)
        return Response(status=204)


urlpatterns = [
    path("session/", SessionView.as_view(), name="auth-session"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("me/password/", PasswordView.as_view(), name="auth-password"),
]
