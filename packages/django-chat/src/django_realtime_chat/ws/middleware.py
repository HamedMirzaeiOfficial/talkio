"""ASGI middleware for WebSocket authentication."""

from __future__ import annotations

from urllib.parse import parse_qs

from channels.auth import AuthMiddlewareStack
from channels.db import database_sync_to_async
from channels.security.websocket import AllowedHostsOriginValidator, OriginValidator

from .tickets import redeem_ticket


class TicketAuthMiddleware:
    """If ``?ticket=`` is present, authenticate with it; otherwise keep the session user."""

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "websocket":
            query = parse_qs(scope.get("query_string", b"").decode("latin-1"))
            ticket = (query.get("ticket") or [None])[0]
            if ticket:
                user = await database_sync_to_async(redeem_ticket)(ticket)
                if user is not None:
                    scope = {**scope, "user": user}
                else:
                    from django.contrib.auth.models import AnonymousUser

                    scope = {**scope, "user": AnonymousUser()}
        return await self.inner(scope, receive, send)


def ChatAuthMiddlewareStack(inner):  # noqa: N802 - mirrors channels.auth.AuthMiddlewareStack
    """Session auth (cookies) plus ticket auth."""
    return AuthMiddlewareStack(TicketAuthMiddleware(inner))


def chat_websocket_application(allowed_origins: list[str] | None = None):
    """A ready-to-mount WebSocket app with origin validation and authentication.

    ``allowed_origins=None`` validates against ``ALLOWED_HOSTS``. Never disable origin
    validation: browsers send cookies on cross-site WebSocket handshakes.
    """
    from channels.routing import URLRouter

    from .routing import websocket_urlpatterns

    app = ChatAuthMiddlewareStack(URLRouter(websocket_urlpatterns))
    if allowed_origins is None:
        return AllowedHostsOriginValidator(app)
    return OriginValidator(app, allowed_origins)
