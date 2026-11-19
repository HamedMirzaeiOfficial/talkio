# WebSocket protocol — version 1

**English** · [فارسی](../fa/websocket.md)

## Endpoints

| URL | Scope |
| --- | --- |
| `/ws/chat/v1/` | All conversations of the authenticated user (recommended; one socket per client). |
| `/ws/chat/v1/conversations/{id}/` | A single conversation (closes with `4404` if you are not a member). |

Frames are JSON text, at most 64 KB. Every frame has a `type`.

The optional `?lang=fa` (or `en`) sets the language of this connection's error messages; without it the handshake's `Accept-Language`, then the server's `LANGUAGE_CODE`, is used. Error `code`s never change.

## Authentication

1. **Session cookie** (same-site deployments): Channels' `AuthMiddlewareStack` reads the Django session from the handshake.
2. **Ticket** (cross-site backends, bearer tokens): `POST /api/chat/v1/ws-ticket/` over authenticated HTTPS returns a ticket; connect to `…/ws/chat/v1/?ticket=<ticket>`. Tickets are signed with the server's `SECRET_KEY`, expire after `CHAT_WS_TICKET_TTL` seconds (default 60) and can be redeemed **once** (atomic `cache.add`; use a shared cache such as Redis with several workers).

The handshake is always **origin-validated** (`AllowedHostsOriginValidator`, or an explicit list passed to `chat_websocket_application(allowed_origins=[…])`). Without it any website could open a socket with a visitor's cookies.

The server accepts the connection before checking authentication so that clients can read the close code:

| Close code | Meaning | Client behavior |
| --- | --- | --- |
| `4401` | Not authenticated | Stop reconnecting; re-authenticate. |
| `4404` | Scoped conversation not found / not a member | Stop. |
| `4000` | Client-initiated (heartbeat timeout, browser offline) | Reconnect. |
| other | Network / server restart | Reconnect with backoff. |

## Server → client events

| `type` | Payload | Scope |
| --- | --- | --- |
| `connection.ready` | `protocol_version`, `connection_id`, `user`, `conversation_ids`, `heartbeat_interval` (s), `server_time` | Sent once after authentication. |
| `message.created` | `conversation_id`, `message` | Conversation members |
| `message.updated` | `conversation_id`, `message` (edits, pin changes) | Members |
| `message.deleted` | `conversation_id`, `message` (tombstone) | Members |
| `reaction.updated` | `conversation_id`, `message_id`, `seq`, `reactions` | Members |
| `typing.updated` | `conversation_id`, `user_id`, `is_typing`, `expires_in` (s) | Members except the typist |
| `presence.updated` | `conversation_id`, `user_id`, `online`, `last_seen_at` | Members of every shared conversation (may arrive once per shared conversation) |
| `read.updated` | `conversation_id`, `user_id`, `last_read_seq` | Members |
| `conversation.updated` | `conversation` (viewer-specific payload) | Each member's own socket; the server also subscribes the socket to new conversations |
| `conversation.removed` | `conversation_id` | The removed user; the server unsubscribes the socket |
| `ack` | `request_id`, `data` | Requesting socket only |
| `error` | `code`, `message`, `request_id`?, `details`? | Requesting socket only |
| `pong` | `request_id`, `server_time` | Requesting socket only |

Message and conversation objects are identical to the REST payloads ([rest-api.md](rest-api.md)).

## Client → server events

```jsonc
{ "type": "ping", "request_id": "p1" }
{ "type": "message.send", "request_id": "r1", "conversation_id": "uuid", "client_id": "uuid",
  "body": "Hello", "reply_to_id": null, "attachment_ids": [], "sticker_id": null }
{ "type": "typing.start", "conversation_id": "uuid" }
{ "type": "typing.stop",  "conversation_id": "uuid" }
{ "type": "read.mark", "request_id": "r2", "conversation_id": "uuid", "seq": 42 }
```

- `message.send` → `ack` with `data: { message, deduplicated }`, or `error` with the same `request_id`. The broadcast `message.created` is sent to all members (including the sender's other devices) **after the database commit**; the sender may receive the broadcast before or after its `ack`.
- `read.mark` → `ack` with `data: { conversation_id, last_read_seq }`.
- `typing.start` is throttled server-side to one broadcast per 2 s per connection; clients re-send while the user keeps typing. Receivers drop the indicator after `expires_in` seconds without a refresh.
- `ping` refreshes the presence lease. Send it every `heartbeat_interval` seconds; if no `pong` arrives within ~10 s, treat the connection as dead and reconnect.

Edits, deletions, reactions, pins and membership changes are performed over REST; their effects arrive as events.

## Error codes

All REST error codes can appear (the same services run behind both transports), plus: `invalid_frame`, `invalid_event`, `unknown_event`, `not_authenticated`, `internal_error`. `rate_limited` includes `details.retry_after`. Limits: `CHAT_RATE_LIMITS["ws_message"|"ws_typing"|"ws_other"]`, per connection.

## Presence

Each connection holds a lease (`connection_id → expiry`) refreshed by `ping`. A user is online while any lease is live, so several tabs/devices are handled and leases from a crashed worker expire after `CHAT_PRESENCE_TTL` seconds. When the last lease is released the server stores `last_seen_at` (durable) and broadcasts `presence.updated`. Leases that *expire* (crash) are not broadcast; clients see the change on their next conversation refresh.

## Ordering, delivery and recovery

- **At-least-once writes, best-effort events.** Writes are idempotent by `client_id`; events are delivered at most once per connected socket and can be lost when a connection drops. The protocol does **not** provide exactly-once delivery.
- **Ordering is per conversation, by `seq`.** Arrival order across conversations is not meaningful. Clients sort by `seq`.
- **Gap detection:** if a `message.created` has `seq > last_seen + 1`, fetch `GET …/messages/?after=<last_seen>`.
- **After reconnecting:** reload the conversation list (unread counts, new conversations), fetch `after=<last seq>` for each open conversation, and `updated_since=<time of last connection.ready>` to pick up edits/deletes. Resend unacknowledged messages with their original `client_id`.

`@realtime-chat/client` implements all of the above.

## Compatibility

The pre-package protocol (`/ws/chat/<slug>/`, `message.create`, `typing.changed`, …) was removed. See [migration-from-v1.md](migration-from-v1.md).
