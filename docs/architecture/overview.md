# Architecture overview

Talkio is a modular monolith plus three reusable packages. The standalone product consumes the packages exactly like a third-party host; there is one messaging backend and one set of chat components.

```mermaid
flowchart LR
  subgraph Clients
    Web["apps/web<br/>(routes, auth, layout)"]
    Host["Any React host<br/>(examples/react-integration)"]
    Other["Any JS host"]
  end
  React["@realtime-chat/react<br/>components · widget · tokens"]
  SDK["@realtime-chat/client<br/>REST · socket · store"]
  Web --> React
  Host --> React
  React --> SDK
  Other --> SDK

  subgraph Django["Django (ASGI / Daphne)"]
    Auth["Host auth<br/>(apps/server accounts, or any host)"]
    API["REST /api/chat/v1"]
    WS["WebSocket /ws/chat/v1"]
    Services["services/<br/>conversations · messages · attachments · presence"]
    Policy["ChatPolicy / UserAdapter hooks"]
    API --> Services
    WS --> Services
    Services --> Policy
  end
  SDK -- HTTPS --> API
  SDK -- WSS --> WS
  Services --> PG[(PostgreSQL)]
  Services -- on_commit fan-out --> Redis[(Redis<br/>channel layer · cache · presence)]
  WS <--> Redis
  Services --> Storage[(Private file storage)]
```

## Request paths

**Sending a message (socket path):**

```mermaid
sequenceDiagram
  participant UI as React UI
  participant SDK as ChatClient
  participant WS as ChatConsumer
  participant S as messages.send_message
  participant DB as PostgreSQL
  participant L as Channel layer
  UI->>SDK: sendMessage(conv, {body, files})
  SDK->>UI: optimistic bubble (status: pending)
  SDK->>SDK: upload files (progress)
  SDK->>WS: message.send {client_id}
  WS->>S: database_sync_to_async
  S->>DB: BEGIN, UPDATE last_seq+1, INSERT message, bind attachments, COMMIT
  S-->>L: on_commit → message.created
  WS-->>SDK: ack {message}
  L-->>SDK: message.created (all members, all devices)
  SDK->>UI: reconcile by client_id (status: sent)
  Note over SDK: no ack in 8 s → POST same client_id over HTTP (deduplicated)
```

**Reconnect:** backoff with full jitter → `connection.ready` → reload conversations → `after=<last seq>` per open conversation → `updated_since=<last ready>` → resend failed messages with their `client_id`.

## Module map

| Area | Path |
| --- | --- |
| Settings + validation | `packages/django-chat/src/django_realtime_chat/conf.py`, `checks.py` |
| Models / migrations | `…/models.py`, `…/migrations/` |
| Business rules | `…/services/` |
| Authorization hooks | `…/permissions.py` (`ChatPolicy`), `…/users.py` (`DefaultUserAdapter`) |
| REST | `…/api/views.py`, `…/api/urls.py` |
| WebSocket | `…/ws/consumer.py`, `…/ws/middleware.py`, `…/ws/tickets.py` |
| Fan-out | `…/events.py` |
| Presence | `…/presence.py` (memory/Redis leases), `…/services/presence.py` |
| SDK | `packages/chat-client/src/` (`client.ts`, `socket.ts`, `store.ts`, `api.ts`, `http.ts`, `auth.ts`) |
| Components | `packages/react-chat/src/components/` |
| Standalone server | `apps/server/` (`core/`, `accounts/`, legacy `chat/`) |
| Standalone web app | `apps/web/src/` |

Decisions are recorded in [decisions/](decisions/). The pre-transformation audit is in [current-state.md](current-state.md).
