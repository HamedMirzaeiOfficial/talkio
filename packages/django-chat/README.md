# django-realtime-chat

Reusable real-time messaging for Django: direct and group conversations, ordered history with cursor pagination, idempotent sends, read receipts and unread counts, typing indicators, multi-device presence, reactions, replies, pins, forwarding, and validated attachments — over Django REST Framework and Django Channels.

```bash
pip install django-realtime-chat            # core
pip install "django-realtime-chat[redis]"   # Redis presence + channel layer
```

```python
INSTALLED_APPS = [..., "rest_framework", "channels", "django_realtime_chat"]
urlpatterns = [..., path("api/chat/v1/", include("django_realtime_chat.urls"))]

# asgi.py
from django_realtime_chat.routing import chat_websocket_application
application = ProtocolTypeRouter({"http": django_asgi_app, "websocket": chat_websocket_application()})
```

- Works with any `AUTH_USER_MODEL`; no dependency on a specific frontend.
- Settings are prefixed `CHAT_` and validated by Django system checks.
- Authorization is extensible through `CHAT_POLICY`, user display through `CHAT_USER_ADAPTER`.

Full integration guide: `docs/integration/django.md` in the source repository. REST and WebSocket contracts: `docs/api/`.

Supports Python 3.10+, Django 4.2 and 5.2 LTS, DRF 3.14+, Channels 4.
