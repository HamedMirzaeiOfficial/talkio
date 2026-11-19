# REST API — `/api/chat/v1/`

**English** · [فارسی](../fa/rest-api.md)

Provided by `django_realtime_chat`. The mount point is chosen by the host (`path("api/chat/v1/", include("django_realtime_chat.urls"))`); paths below are relative to it.

## Conventions

- **Authentication:** the host's DRF authentication classes (session by default), or `CHAT_API_AUTHENTICATION_CLASSES`. Every endpoint requires an authenticated user.
- **CSRF:** with session authentication, unsafe methods need `X-CSRFToken` (Django double-submit cookie).
- **Bodies** are JSON unless noted. **Timestamps** are ISO 8601 with timezone.
- **IDs:** conversations, messages and attachments are UUIDs; users keep the host's primary key type.
- **Privacy:** a conversation, message or attachment you cannot access returns `404`, never `403`, so private resources cannot be probed.
- **Language:** with `LocaleMiddleware` in the host, error `message`s are in the request's `Accept-Language` (e.g. `fa`). `code` and `details` are never translated; clients should decide on `code`.
- **Errors** always use one envelope:

```json
{ "error": { "code": "message_too_long", "message": "Messages are limited to 4000 characters.", "details": { "max_length": 4000 } } }
```

| Status | Typical codes |
| --- | --- |
| 400 | `validation_error`, `empty_message`, `message_too_long`, `invalid_client_id`, `invalid_cursor`, `invalid_reply`, `invalid_members`, `invalid_attachments`, `unsupported_file_type`, `file_too_large`, `invalid_image`, `too_many_pending`, `message_deleted` |
| 403 | `not_authenticated`, `forbidden`, `feature_disabled`, `edit_window_expired` |
| 404 | `not_found` |
| 429 | `rate_limited` (with `details.retry_after` seconds and a `Retry-After` header) |

Rate limits (`CHAT_RATE_LIMITS`): `http_write` for unsafe methods, `http_upload` for uploads, `http_search` for searches — per user, stored in the Django cache (use Redis with several workers).

## Configuration

`GET /config/` — limits and feature flags for clients, plus the current user.

```json
{
  "version": "0.1.0", "protocol_version": 1,
  "user": { "id": 1, "display_name": "Alice Moreau", "username": "alice", "avatar_url": null, "online": true, "last_seen_at": null },
  "features": { "groups": true, "attachments": true, "reactions": true, "user_search": true, "stickers": true, "voice": true },
  "limits": { "max_message_length": 4000, "max_attachment_size": 10485760, "max_attachments_per_message": 10, "max_group_members": 256, "edit_window": null },
  "allowed_attachment_types": ["image/jpeg", "image/png", "…"],
  "allowed_reactions": null, "quick_reactions": ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👀"],
  "presence_ttl": 60, "typing_timeout": 6
}
```

`POST /ws-ticket/` → `{ "ticket": "…", "expires_in": 60 }` — a signed, single-use ticket for WebSocket authentication when cookies cannot reach the socket (see [websocket.md](websocket.md#authentication)).

## Conversations

### Object

```json
{
  "id": "uuid", "kind": "group", "title": "Product design", "description": "",
  "created_at": "…", "last_seq": 12, "last_message": { "…message…" }, "last_activity_at": "…",
  "unread_count": 3, "my_role": "owner", "my_last_read_seq": 9, "member_count": 6,
  "peer": null,
  "members": [{ "id": 2, "display_name": "Bob", "username": "bob", "avatar_url": null,
                "online": false, "last_seen_at": "…", "role": "member", "last_read_seq": 12, "joined_at": "…" }]
}
```

For `kind: "direct"`, `title` is the other person's display name and `peer` is that person. Payloads are viewer-specific (`unread_count`, `my_*`).

| Method | Path | Body / query | Notes |
| --- | --- | --- | --- |
| GET | `/conversations/` | `limit` (≤100), `before` (opaque cursor), `kind`, `q` | Ordered by last activity. Response: `{results, has_more, next_cursor}`. |
| POST | `/conversations/` | `{"kind":"direct","user_id":2}` | Returns the existing conversation (`200`, `created:false`) or a new one (`201`). Unique per user pair, also under concurrency. |
| POST | `/conversations/` | `{"kind":"group","title":"…","member_ids":[2,3],"description":""}` | Creator becomes `owner`. Requires `CHAT_ENABLE_GROUPS`. |
| GET | `/conversations/{id}/` | | |
| PATCH | `/conversations/{id}/` | `{"title"?, "description"?}` | Groups only; admins/owner (or `members_can_edit_info`). |
| POST | `/conversations/{id}/read/` | `{"seq": 12}` | Monotonic: never moves the marker backwards; clamped to `last_seq`. Broadcasts `read.updated`. |
| GET | `/conversations/{id}/members/` | | `{results: Member[]}` |
| POST | `/conversations/{id}/members/` | `{"user_ids":[4]}` | Admin/owner (or `members_can_add_members`). Re-added members start reading at the current end. |
| PATCH | `/conversations/{id}/members/{user_id}/` | `{"role":"admin"\|"member"\|"owner"}` | Owner only. Transferring `owner` demotes the previous owner to admin. |
| DELETE | `/conversations/{id}/members/{user_id}/` | | Remove a member, or leave when `user_id` is yourself. Owners leaving hand ownership to the longest-standing admin, else member. |

## Messages

### Object

```json
{
  "id": "uuid", "conversation_id": "uuid", "seq": 42, "client_id": "8c0b…",
  "sender": { "id": 1, "display_name": "Alice", "username": "alice", "avatar_url": null },
  "body": "Hello", "created_at": "…", "edited_at": null, "deleted_at": null, "is_deleted": false,
  "reply_to": { "id": "uuid", "seq": 40, "conversation_id": "uuid", "sender": {…}, "body": "first 280 chars", "is_deleted": false },
  "forwarded_from": null, "pinned_at": null,
  "attachments": [{ "id": "uuid", "name": "voice.webm", "content_type": "audio/webm", "size": 1234,
                    "width": null, "height": null, "url": "/api/chat/v1/attachments/{id}/download/",
                    "thumbnail_url": null, "is_voice": true, "duration": 3.4, "waveform": [0, 40, 100, 62], "…": "…" }],
  "sticker": null,
  "reactions": [{ "emoji": "👍", "count": 2, "user_ids": [2, 3] }],
  "kind": "voice"
}
```

`kind` summarizes the content for previews: `text`, `image`, `gif`, `video`, `audio`, `voice`, `file`, `sticker` or `deleted` (reply quotes carry it too). A sticker message has `sticker: {id, pack_id, emoji, content_type, width, height, url}` and no body or attachments.

`body` is plain text. Clients must render it as text (never as HTML). Deleted messages keep `id` and `seq` (tombstones) with empty `body`, `attachments` and `reactions`.

| Method | Path | Body / query | Notes |
| --- | --- | --- | --- |
| GET | `/conversations/{id}/messages/` | `limit` (≤100, default 50) and **one of** `before=<seq>`, `after=<seq>`; or `updated_since=<iso>`; or `pinned=1` | Results are always in ascending `seq`. See pagination. |
| POST | `/conversations/{id}/messages/` | `{"body", "client_id", "reply_to_id"?, "attachment_ids"?, "sticker_id"?}` | Idempotent by `client_id` (see below). `201` new / `200` with `deduplicated: true`. |
| PATCH | `/messages/{id}/` | `{"body"}` | Sender only, within `CHAT_EDIT_WINDOW` if set. |
| DELETE | `/messages/{id}/` | | Sender, or group admin/owner when `admins_can_delete_messages`. Returns the tombstone. Files are deleted after commit. |
| POST | `/messages/{id}/reactions/` | `{"emoji"}` | Toggles your reaction. Any single emoji (incl. skin tones, ZWJ sequences, flags) unless `CHAT_ALLOWED_REACTIONS` lists the allowed ones. |
| POST | `/messages/{id}/pin/` | | Toggles. Groups: admins or `members_can_pin`. |
| POST | `/messages/{id}/forward/` | `{"conversation_id","client_id"}` | Requires membership in both conversations; copies attachments by reference. |
| GET | `/messages/search/` | `q` (2–100 chars), `conversation_id`?, `before` (cursor) | Only conversations you are an active member of; deleted messages excluded. |

### Pagination

Every message has a per-conversation sequence number `seq` (1, 2, 3 …, gap-free).

- Latest page: `GET …/messages/?limit=50` → the 50 newest, ascending. `has_more` means older messages exist; continue with `before=<next_cursor>`.
- Gap recovery: `GET …/messages/?after=<last seen seq>` → newer messages ascending; continue with `after=<next_cursor>` while `has_more`.
- Edits/deletes/reactions since a time: `GET …/messages/?updated_since=<iso>` (up to 200).

### Idempotency

`client_id` (1–64 chars, `[A-Za-z0-9_.:-]`) is unique per `(conversation, sender)`. Sending the same `client_id` again returns the original message, does not consume a sequence number and does not broadcast again. This holds under concurrent retries (database unique constraint + transaction rollback). Clients should generate a UUID per message and reuse it for every retry, over HTTP or WebSocket.

## Users

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/users/search/?q=` | Matches `CHAT_USER_ADAPTER` search fields among users returned by `ChatPolicy.user_queryset()`. Empty `q` returns people you already share conversations with. Max 20. Never includes email. |
| GET | `/users/{id}/` | Profile with presence. Visible when discoverable or sharing a conversation. |

## Attachments

Upload first, then reference the IDs when sending.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/attachments/` | `multipart/form-data` with `conversation_id` and `file`; for voice notes also `voice=1`, `duration` (seconds, ≤ `CHAT_MAX_VOICE_DURATION`) and `waveform` (JSON list of ≤128 integers 0–100). Large still images get a WebP preview (`thumbnail_url`). Type is detected from content (magic bytes), not from the client; images are verified with Pillow when installed. Returns a pending attachment visible only to the uploader. |
| GET | `/attachments/{id}/` | Metadata. |
| DELETE | `/attachments/{id}/` | Discard your own pending upload. |
| GET | `/attachments/{id}/download/` | Authorized download (`?variant=thumb` for the preview). Sends `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Content-Disposition` (`inline` only for images/audio/video), `Cache-Control: private`. |

WebM and MP4 containers are identified from their bytes; the declared type only decides between the audio variant (`audio/webm`, `audio/mp4` — browser voice recordings) and the video variant.

## Stickers

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/stickers/` | Active packs: `{results: [{id, name, stickers: [{id, pack_id, emoji, content_type, width, height, url}]}]}` |
| GET | `/stickers/{id}/file/` | The image (any authenticated user; long-lived private cache). |

Packs are created by staff in the Django admin; uploads are validated (PNG/WebP/GIF, ≤ `CHAT_MAX_STICKER_SIZE`, ≤ 512×512). Send with `{"sticker_id": "…"}` and no body/attachments. Retired packs (`is_active=False`) cannot be sent but old messages still render.

Limits: `CHAT_MAX_ATTACHMENT_SIZE`, `CHAT_ALLOWED_ATTACHMENT_TYPES` (active types such as SVG/HTML are rejected by a system check), `CHAT_MAX_ATTACHMENTS_PER_MESSAGE`, `CHAT_MAX_PENDING_ATTACHMENTS` (per user per 24 h). `manage.py chat_purge_uploads` removes uploads never sent.

## Standalone app endpoints (not part of the package)

`apps/server` adds `/api/auth/` — `GET session/` (bootstrap + CSRF cookie), `POST login/`, `POST register/`, `POST logout/`, `GET|PATCH me/`, `POST me/password/` — and `/api/health/`, `/api/health/ready/`. Hosts embedding the package use their own authentication instead.
