"""ASGI entry point: HTTP through Django, WebSockets through the chat package."""

import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

from channels.routing import ProtocolTypeRouter  # noqa: E402
from django.conf import settings  # noqa: E402
from django.core.asgi import get_asgi_application  # noqa: E402

django_application = get_asgi_application()

from django_realtime_chat.routing import chat_websocket_application  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_application,
        # Origin validation is always on: ALLOWED_HOSTS, or an explicit list.
        "websocket": chat_websocket_application(settings.WEBSOCKET_ALLOWED_ORIGINS or None),
    }
)
