# Migrating from the pre-package API (`/api/v1/`, `/ws/chat/<slug>/`)

The original `chat` app exposed an unversioned-by-package API at `/api/v1/` and a per-room socket at `/ws/chat/<slug>/`. It was replaced by `django_realtime_chat` (`/api/chat/v1/`, `/ws/chat/v1/`). This is a **breaking change**; the old endpoints now answer `410 Gone` with code `api_version_removed`.

## Data

Existing rows are not modified. Run the idempotent import once per environment (it can be re-run safely):

```bash
python manage.py import_legacy_chat --dry-run   # report only
python manage.py import_legacy_chat
```

| Legacy | New |
| --- | --- |
| `ChatRoom` (`kind`, `name`, `users`) | `Conversation` (deterministic UUID from the room id) + `Membership` rows; the lowest user id becomes group owner |
| `ChatRoom.kind="direct"` with two users | direct conversation with `direct_key` |
| `Message` ordered by `(timestamp, id)` | `Message` with `seq` 1..n; `id` = legacy `server_id`; `client_id` preserved |
| `edited_at`, `deleted_at`, `pinned_at`, `forwarded_from` | preserved |
| `MessageReaction` | `Reaction` |
| `Attachment` (public `MEDIA_ROOT`) | copied into the private attachment storage |
| `seen_by` (never written) | not imported; read markers start at the last message |
| `UserStatus` (multi-table inheritance defect) | not imported; presence is transient, `last_seen_at` lives in `UserPresence` |

## Endpoint mapping

| Old | New |
| --- | --- |
| `POST /api/v1/auth/login/` (`identifier`/`password` or demo `phone`/`code`) | `POST /api/auth/login/` (same bodies) |
| `POST /api/v1/auth/register/` (`phone`, `password`, `password_confirm`) | `POST /api/auth/register/` (`username`, `display_name`, `password`, `email?`) |
| `GET /api/v1/auth/csrf/` | `GET /api/auth/session/` (also returns the user) |
| `GET/PATCH /api/v1/auth/me/` | `GET/PATCH /api/auth/me/` |
| `GET /api/v1/conversations/` | `GET /api/chat/v1/conversations/` |
| `POST /api/v1/conversations/` (`kind`, `name`, `member_ids`) | `POST /api/chat/v1/conversations/` — direct: `{kind, user_id}`; group: `{kind, title, member_ids}` |
| `GET /api/v1/users/?q=` | `GET /api/chat/v1/users/search/?q=` |
| `GET/POST /api/v1/conversations/<slug>/messages/` (`before=<timestamp>`) | `…/conversations/<uuid>/messages/` (`before=<seq>`) |
| `PATCH/DELETE /api/v1/messages/<uuid>/` | same under `/api/chat/v1/` (DELETE now returns the tombstone instead of 204) |
| `POST /api/v1/messages/<uuid>/reactions/`, `/pin/`, `/forward/` | same under `/api/chat/v1/`; forward body uses `conversation_id` |
| `GET /api/v1/messages/search/?conversation=<slug>` | `GET /api/chat/v1/messages/search/?conversation_id=<uuid>` |
| `POST /api/v1/attachments/` (requires `message_id`) | `POST /api/chat/v1/attachments/` (`conversation_id`), then send `attachment_ids` |
| `GET /api/v1/attachments/<int>/` | `GET /api/chat/v1/attachments/<uuid>/download/` |
| `GET /api/v1/health/…` | `GET /api/health/…` |

## WebSocket

| Old | New |
| --- | --- |
| `ws/chat/<slug>/` (one socket per room) | `ws/chat/v1/` (one socket for all conversations) |
| `{"event":"message.create","request_id","body"}` | `{"type":"message.send","request_id","conversation_id","client_id","body"}` |
| `message.created` (`request_id`, `deduplicated`) | `ack` to the sender + `message.created` to members |
| `typing.start/stop` → `typing.changed` | same client events (+ `conversation_id`) → `typing.updated` |
| `read.update` → `message.read` | `read.mark` (`seq`) → `read.updated` (`last_read_seq`) |
| `presence.changed` (`status`) | `presence.updated` (`online`, `last_seen_at`) |
| close `4403` | close `4401` / `4404` |
