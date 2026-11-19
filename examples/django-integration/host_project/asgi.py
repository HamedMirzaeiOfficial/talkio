import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "host_project.settings")

from channels.routing import ProtocolTypeRouter  # noqa: E402
from django.core.asgi import get_asgi_application  # noqa: E402

http = get_asgi_application()

from django_realtime_chat.routing import chat_websocket_application  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": http,
        # Session auth from the host + origin validation against ALLOWED_HOSTS.
        "websocket": chat_websocket_application(),
    }
)
