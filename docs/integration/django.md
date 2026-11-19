# Integrating `django-realtime-chat` into an existing Django project

A complete working example lives in [`examples/django-integration`](../../examples/django-integration) (stock `django.contrib.auth.User`, a custom policy, private storage, tests).

## 1. Install

```bash
pip install "django-realtime-chat[redis,images]"   # redis: multi-process presence; images: Pillow verification
```

Requirements: Python 3.10+, Django 4.2 or 5.2, DRF 3.14+, Channels 4. An ASGI server (Daphne, Uvicorn) is needed for WebSockets.

## 2. Settings

```python
INSTALLED_APPS += ["rest_framework", "channels", "django_realtime_chat"]

ASGI_APPLICATION = "myproject.asgi.application"
CHANNEL_LAYERS = {"default": {"BACKEND": "channels_redis.core.RedisChannelLayer", "CONFIG": {"hosts": [REDIS_URL]}}}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": REDIS_URL}}

STORAGES = {
    **STORAGES,
    # Not publicly served. Any Django storage works (e.g. S3 without public ACLs).
    "chat_files": {"BACKEND": "django.core.files.storage.FileSystemStorage",
                   "OPTIONS": {"location": BASE_DIR / "private_media", "base_url": None}},
}
CHAT_ATTACHMENT_STORAGE = "chat_files"
CHAT_PRESENCE_BACKEND = "redis"
CHAT_REDIS_URL = REDIS_URL
```

Then `python manage.py migrate`.

## 3. URLs and ASGI

```python
# urls.py — the "realtime_chat" namespace is set by the include
path("api/chat/v1/", include("django_realtime_chat.urls")),
```

```python
# asgi.py
from channels.routing import ProtocolTypeRouter
from django.core.asgi import get_asgi_application
django_app = get_asgi_application()
from django_realtime_chat.routing import chat_websocket_application

application = ProtocolTypeRouter({
    "http": django_app,
    "websocket": chat_websocket_application(),  # session + ticket auth, origin-validated
})
```

To compose your own stack instead, use `ChatAuthMiddlewareStack` and `websocket_urlpatterns` from `django_realtime_chat.routing`, and keep an origin validator in front.

## 4. Authentication

The package never authenticates users itself.

- **REST:** uses your `REST_FRAMEWORK["DEFAULT_AUTHENTICATION_CLASSES"]`, or `CHAT_API_AUTHENTICATION_CLASSES` (dotted paths) to override for chat only — e.g. your JWT class.
- **WebSocket:** the session cookie works when the browser reaches the socket on the same site. Otherwise the client calls `POST /api/chat/v1/ws-ticket/` (authenticated with your REST auth) and connects with `?ticket=`. Tickets are signed, expire in 60 s and are single-use.

There is no "trust this user id" mode. User identity always comes from `request.user` / `scope["user"]`.

## 5. Settings reference

All optional; validated at startup by system checks (`realtime_chat.E00x`).

| Setting | Default | Purpose |
| --- | --- | --- |
| `CHAT_ENABLE_GROUPS` | `True` | Allow group conversations |
| `CHAT_ENABLE_ATTACHMENTS` | `True` | Allow uploads |
| `CHAT_ENABLE_REACTIONS` | `True` | Allow reactions |
| `CHAT_ENABLE_USER_SEARCH` | `True` | Allow `/users/search/` |
| `CHAT_ENABLE_STICKERS` | `True` | Sticker packs and sticker messages |
| `CHAT_ENABLE_VOICE` | `True` | Voice notes (also needs attachments) |
| `CHAT_MAX_VOICE_DURATION` | `600` | Seconds |
| `CHAT_MAX_STICKER_SIZE` | `512 KiB` | Bytes per sticker file |
| `CHAT_THUMBNAIL_SIZE` | `480` | Longest side of image previews (px) |
| `CHAT_MAX_MESSAGE_LENGTH` | `4000` | Characters |
| `CHAT_MAX_ATTACHMENT_SIZE` | `10 MiB` | Bytes per file |
| `CHAT_MAX_ATTACHMENTS_PER_MESSAGE` | `10` | |
| `CHAT_MAX_PENDING_ATTACHMENTS` | `20` | Unsent uploads per user per 24 h |
| `CHAT_MAX_GROUP_MEMBERS` | `256` | |
| `CHAT_ALLOWED_ATTACHMENT_TYPES` | images (incl. GIF), PDF, text, audio (incl. `audio/webm`, `audio/mp4` voice), video | Detected type allow-list (SVG/HTML rejected by a check) |
| `CHAT_ATTACHMENT_STORAGE` | `"default"` | `STORAGES` alias — use a private one |
| `CHAT_ATTACHMENT_UPLOAD_TO` | `"chat/attachments/%Y/%m/"` | Folder; file names are random |
| `CHAT_ALLOWED_REACTIONS` | `None` | `None` = any emoji; a list restricts reactions |
| `CHAT_QUICK_REACTIONS` | 8 emoji | Offered first in pickers |
| `CHAT_DEFAULT_PERMISSIONS` | see below | Toggles for the default policy |
| `CHAT_POLICY` | `django_realtime_chat.permissions.ChatPolicy` | Authorization hooks |
| `CHAT_USER_ADAPTER` | `django_realtime_chat.users.DefaultUserAdapter` | Display name, handle, avatar, search fields |
| `CHAT_PRESENCE_BACKEND` | `"memory"` | `"redis"` for more than one process (warning `W002` otherwise) |
| `CHAT_REDIS_URL` | `None` | Required for Redis presence |
| `CHAT_PRESENCE_TTL` | `60` | Lease seconds; clients ping every TTL/2 |
| `CHAT_TYPING_TIMEOUT` | `6` | Seconds a typing indicator stays without refresh |
| `CHAT_EDIT_WINDOW` | `None` | Seconds after sending during which edits are allowed |
| `CHAT_WS_TICKET_TTL` | `60` | Seconds |
| `CHAT_API_AUTHENTICATION_CLASSES` | `None` | Override DRF auth for chat views |
| `CHAT_RATE_LIMITS` | `http_write 120/m, http_upload 30/m, http_search 60/m, ws_message 30/10s, ws_typing 20/10s, ws_other 60/10s` | Merged with defaults |

`CHAT_DEFAULT_PERMISSIONS` defaults: `members_can_add_members=False`, `members_can_edit_info=False`, `members_can_pin=True`, `admins_can_delete_messages=True`.

## 6. Extension hooks

```python
# myproject/chat.py
from django_realtime_chat.permissions import ChatPolicy
from django_realtime_chat.users import DefaultUserAdapter

class TenantPolicy(ChatPolicy):
    def user_queryset(self, user):          # who can be discovered / added
        return super().user_queryset(user).filter(tenant=user.tenant)

    def can_send_message(self, user, conversation, membership):
        return super().can_send_message(user, conversation, membership) and not user.is_suspended

class ProfileAdapter(DefaultUserAdapter):
    search_fields = ("username", "profile__nickname")
    def display_name(self, user): return user.profile.nickname or user.get_username()
    def avatar_url(self, user):   return user.profile.photo.url if user.profile.photo else None
```

```python
CHAT_POLICY = "myproject.chat.TenantPolicy"
CHAT_USER_ADAPTER = "myproject.chat.ProfileAdapter"
```

Policy methods: `user_queryset`, `can_search_users`, `can_start_direct`, `can_create_group`, `can_edit_conversation`, `can_add_members`, `can_remove_member`, `can_change_role`, `can_send_message`, `can_edit_message`, `can_delete_message`, `can_pin_message`.

## 7. Signals

Sent after commit from `django_realtime_chat.signals`: `message_created(message, created_by)`, `message_updated`, `message_deleted`, `conversation_created`, `members_changed(conversation, added_user_ids, removed_user_ids, changed_by)`. Use them for push notifications, e-mail digests or search indexing.

## 8. Calling services directly

`django_realtime_chat.services.*` are plain synchronous functions that enforce the same authorization as the API, e.g. `send_message(user, conversation_id, body="…")`, `start_direct(user, other_id)`, `create_group(user, title=…, member_ids=[…])`. Broadcasts are scheduled on commit.

## 9. Maintenance

- `python manage.py chat_purge_uploads --hours 24` (cron) removes uploads that were never sent.
- Admin: conversations, messages (metadata only in list views), attachments, reactions and presence are registered.
