# Security model

**English** · [فارسی](fa/security.md)

## Authorization

- Every operation resolves the conversation through the caller's **active membership** (`left_at IS NULL`). Removed members lose access immediately (REST and new socket events; the consumer unsubscribes on `conversation.removed`).
- Inaccessible conversations, messages and attachments return **404**, never 403, so their existence is not revealed.
- Role rules (owner/admin/member) and feature flags are enforced in services through `ChatPolicy`; the UI only mirrors them.
- User discovery is limited to `ChatPolicy.user_queryset()` and to people you already share conversations with. Search results never contain e-mail addresses; the standalone app also hides phone numbers that legacy accounts used as usernames.
- The client never supplies its own identity. Sender, membership and role come from the authenticated user on the server.

## Authentication and sessions

- Host-provided. The standalone app uses Django sessions: `HttpOnly`, `SameSite=Lax`, `Secure` when `DEBUG=0`; CSRF double-submit (`X-CSRFToken`). Login and registration enforce CSRF even though the user is anonymous (prevents login CSRF), and are rate-limited per IP (`auth` scope).
- WebSocket handshakes are **origin-validated**. Cookie-less clients use signed, 60-second, single-use tickets; tokens never appear in socket URLs.
- The SDK does not persist credentials: adapters fetch headers per request from the host.
- `SECRET_KEY` is required when `DEBUG=0` (the server refuses to start without it) and is never sent to clients.

## Content safety

- Messages are stored and rendered as **plain text**. The React components build text nodes; only `http(s)` URLs become links (`rel="noopener noreferrer nofollow ugc"`, new tab). Tests assert that markup in messages is not interpreted.
- Bidi override/isolate characters and NUL bytes are stripped; length is limited by `CHAT_MAX_MESSAGE_LENGTH`.

## Attachments

- Type is detected from file content (magic bytes); the client's declared type is ignored. Images are decoded with Pillow (rejects corrupt files and decompression bombs). SVG, HTML and scripts are never accepted (also enforced by a system check on the allow-list).
- Size, count per message and pending uploads per user are limited.
- Stored under random names in a **private** storage alias; downloads go through a membership-checked view with `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-site` and `Content-Disposition: attachment` for everything except images/audio/video.
- Voice-note metadata (duration, waveform) is range-checked; stickers are staff-curated and validated like attachments (no SVG, size and dimension limits); image previews are re-encoded to WebP by Pillow, never served from the original bytes.
- Pending uploads are visible only to the uploader and can only be attached by them, to a message in the same conversation.

## Abuse and resource limits

- Per-user HTTP throttles (writes, uploads, searches) and per-connection WebSocket token buckets (messages, typing, other); 64 KB frame limit; typing broadcasts throttled server-side.
- Login/registration throttles key on the client IP. `X-Forwarded-For` is only honoured for `TRUSTED_PROXY_COUNT` proxies, so the limit cannot be bypassed by forging the header (regression test in `apps/server/tests/test_hardening.py`).
- Client-supplied ids are validated against the primary-key type and range before reaching the database.
- Bounded page sizes (≤100 messages, ≤50 conversations per request), search query length 2–100.

## Logging and privacy

- Logs carry event types and IDs, not message bodies or credentials. The admin list view shows message metadata only.
- Deleted messages keep a tombstone (id, seq, timestamps) with the body and attachments removed.
- Error messages come back in the request's language (`Accept-Language`, or `?lang=` on the socket); the error `code` is always the same English identifier, so clients decide on the code, never on the text.

## Known limitations

- Not end-to-end encrypted; messages are readable by the server operator and database administrators.
- WebSocket rate limits are per connection; a user with many connections gets proportionally more budget (HTTP limits are per user).
- With `CHAT_PRESENCE_BACKEND="memory"` or a non-shared cache, presence, throttles and ticket single-use are per process. Use Redis in production.
- Host CSS with ID-level specificity can still restyle embedded components.
- No virus scanning of uploads; add it in a storage backend or with the `message_created` signal if required.
- Admins of a group can remove other members' messages when `admins_can_delete_messages` is on (default).

## Reporting

Please report vulnerabilities privately to the maintainer rather than opening a public issue.
