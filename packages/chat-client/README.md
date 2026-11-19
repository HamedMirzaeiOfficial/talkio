# @realtime-chat/client

Framework-independent TypeScript SDK for `django-realtime-chat`: typed REST client, resilient WebSocket manager (backoff with jitter, heartbeat, offline handling, gap recovery) and a reactive store with optimistic sends.

```ts
import { createChatClient, sessionAuth } from '@realtime-chat/client';
const client = createChatClient({ baseUrl: '/api/chat/v1', wsUrl: '/ws/chat/v1', auth: sessionAuth() });
await client.start();
client.subscribe(() => console.log(client.getState().list.ids));
```

Docs: `docs/integration/react.md` (SDK section) and `docs/api/` in the repository. Tests: `npm test`.
