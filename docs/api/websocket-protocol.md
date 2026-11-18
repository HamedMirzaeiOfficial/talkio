# WebSocket Protocol

Endpoint: `ws(s)://<host>/ws/chat/<conversation-slug>/`

The handshake uses the authenticated Django session cookie. Anonymous users and users without active membership are rejected. All payloads are JSON objects with an `event` field. Server responses include `type`, `request_id` when supplied, and canonical server data.

## Client events

```json
{"event":"message.create","request_id":"client-uuid","body":"Hello"}
{"event":"typing.start","request_id":"typing-1"}
{"event":"typing.stop","request_id":"typing-2"}
{"event":"read.update","message_id":"server-uuid"}
```

`message.create` is idempotent by `(sender, conversation, request_id)`. Retrying the same request returns the same server message. Message bodies are bounded and treated as plain text.

## Server events

```json
{"type":"message.created","request_id":"client-uuid","message":{"id":"server-uuid","body":"Hello","created_at":"2026-11-18T10:00:00Z"}}
{"type":"presence.changed","user_id":42,"status":"online"}
{"type":"typing.changed","user_id":42,"is_typing":true}
{"type":"message.read","user_id":42,"message_id":"server-uuid"}
{"type":"error","code":"not_a_member","message":"You cannot access this conversation."}
```

The protocol is at-least-once. Clients must deduplicate by server message ID and recover missed history with the HTTP history endpoint after reconnecting. Exact field availability follows the implemented version; examples are not claims about unimplemented features.
