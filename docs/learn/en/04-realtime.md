# Chapter 4 — Real-time communication: ASGI, Channels and protocol design

**English** · [فارسی](../04-realtime.md)

Files for this chapter: `apps/server/core/asgi.py`, `ws/consumer.py`, `ws/middleware.py`, `events.py`, `presence.py`, `services/presence.py`, [websocket.md](../../api/websocket.md)

## 1. WSGI versus ASGI

**WSGI** (Django's classic model) assumes every request has one response and is then over. A WebSocket is a long-lived connection where both sides send messages at any time. **ASGI** is the async version of the standard and supports long-lived connections. **Daphne** is an ASGI server, and **Channels** is the layer that brings WebSocket to Django.

```python
# core/asgi.py
application = ProtocolTypeRouter({
    "http": django_application,                         # ordinary requests
    "websocket": chat_websocket_application(...),        # WebSocket
})
```

## 2. Consumers and the channel layer

Each WebSocket connection is an instance of `ChatConsumer`. The problem: a message stored in process A must reach a user whose socket lives in process B. The **channel layer** (Redis in production) solves this:

- Each consumer has a unique "channel".
- Channels can join **groups** (`group_add`).
- `group_send(group, message)` delivers the message to every member channel, in whatever process it lives.

This project has two kinds of group:

| Group | Members | Use |
| --- | --- | --- |
| `rtchat.c.<conversation>` | all sockets of the conversation's members | messages, edits, typing, reads, presence |
| `rtchat.u.<user>` | all sockets of one user | `conversation.updated` / `removed` (a viewer-specific payload) |

## 3. One socket per client

The old code opened one socket per room. To show a conversation list with "unread" badges you need events from every conversation; with 30 conversations that means 30 sockets. The new design: **one socket at `/ws/chat/v1/`** that joins the groups of all the user's conversations on connect ([ADR 0004](../../architecture/decisions/0004-one-socket-per-client.md)).

When a user is added to a new conversation, the socket must join the new group without reconnecting. It works like this: the service sends `conversation.updated` to the user's group and the consumer calls `group_add` right away in `chat_event`. The reverse works too: `conversation.removed` triggers `group_discard`, plus a filter that drops "leftover" events that were already queued before the discard.

## 4. The connection lifecycle

```python
async def connect(self):
    await self.accept()                          # 1. accept first
    if not self.user.is_authenticated:
        await self._error("not_authenticated", ...)
        await self.close(code=4401)              # 2. then close with a specific code
        return
```

Why accept and then close? If the handshake is rejected, the browser only sees a generic network error and cannot tell it from "the server is down", so it keeps retrying. By accepting and closing with an **application code** (4401 means not authenticated), the SDK knows retrying is pointless. Codes 4000 to 4999 are reserved for applications.

The consumer also decides the connection's language here (`connection_language`: `?lang=`, then the handshake's `Accept-Language`), because WebSockets do not pass through Django's `LocaleMiddleware` (chapter 13).

## 5. From threads to async: `database_sync_to_async`

The consumer runs on the event loop (async). Django's ORM is sync. Calling the ORM directly from async code would block the whole loop, and Django raises `SynchronousOnlyOperation` anyway. The solution:

```python
@database_sync_to_async
def _send_message(user, data): ...       # runs in a thread
result = await _send_message(self.user, content)
```

The very same service functions the views use are used here too. That is the payoff of separating layers in chapter 1.

## 6. Protocol design

Principles followed in [websocket.md](../../api/websocket.md):

- **Every frame has a `type`.** Both server and client messages are JSON with a `type`.
- **Request/ack correlation.** The client sends a `request_id`; the reply (`ack` or `error`) echoes it. That way several concurrent requests on one socket never get mixed up.
- **The same payload as REST.** `message.created` carries the same message object that `GET /messages/` returns, because both come from `serializers.message_payload`.
- **Documented limits:** a 64 KB cap per frame, a rate limit for each category.
- **Honesty about guarantees:** ordering is guaranteed only within one conversation (by `seq`), not across conversations. Events can be lost, and the client must recover with `after` and `updated_since`.

## 7. Typing: transient data

"Ali is typing" is not stored in the database. It goes straight to the channel layer. It has three safeguards:

1. **Server-side throttle:** at most one `typing.start` every 2 seconds per connection and conversation.
2. **Expiry:** every event carries `expires_in`; if `typing.stop` gets lost, the client clears the indicator itself after 6 seconds.
3. **Filtering:** a person's own typing event is not sent back to them.

**The lesson:** separate transient data from durable data. Something that does not matter if lost should not cost a database write.

## 8. Presence: being online on several devices

The old code had a `Boolean online`: the phone connected and it became `True`, the laptop disconnected and it became `False`, while the phone was still connected. A counter (`active_connections`) does not solve it either: if the server crashes, `disconnect` never runs and the counter stays up forever.

### The solution: leases with an expiry

Each connection holds a **lease**: "connection X is alive until time T". A user is online if they have at least one unexpired lease. The client sends a `ping` every 30 seconds and the lease is renewed. If the server crashes, the leases expire on their own after 60 seconds and nothing needs cleaning up.

In Redis this is a **sorted set** (`RedisPresenceStore`): member = connection id, score = expiry time.

```
ZREMRANGEBYSCORE key -inf now     # drop expired leases
ZCARD key                         # before adding: was the user offline?
ZADD key expiry connection_id
EXPIRE key ttl*2                  # the key itself eventually goes away too
```

All of it in one **pipeline**, that is, one network round trip.

The durable part, "last seen", is written to the database (`UserPresence`) only when the last lease is released.

## 9. Broadcasting after commit, "best effort"

`events._send` logs channel-layer errors but does not raise them. If Redis is briefly unavailable, **the message is stored** but not broadcast. Clients pick it up later through recovery. The design lesson: **the critical path (storing data) must not depend on a supporting path (notification).**

## Exercises

1. Open two browser tabs as the same user. Close one. What presence does the other user's tab show? Where in the code is that guaranteed?
2. Read the test `test_membership_changes_update_subscriptions` and explain step by step why a removed member no longer receives messages.
3. Design a new `message.viewed` event (a "seen" receipt for voice messages): its payload, whether it is durable or transient, and which group it is sent to.
