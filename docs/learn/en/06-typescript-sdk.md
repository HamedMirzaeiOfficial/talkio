# Chapter 6 — The TypeScript SDK: an unreliable network, a reliable state

**English** · [فارسی](../06-typescript-sdk.md)

Files for this chapter: `packages/chat-client/src/{http,socket,store,client,auth,errors}.ts` and the tests in `packages/chat-client/test/`

## 1. Why an SDK independent of React?

The hard logic of chat (optimistic messages, recovery after a disconnect, unread counts) has nothing to do with React. Written inside components, it would have to be rewritten for Vue or a mobile app, and testing it would need a DOM. So the SDK exposes a **store** with two simple methods: `subscribe(listener)` and `getState()`. Any framework can connect to it ([ADR 0005](../../architecture/decisions/0005-store-in-the-sdk.md)).

## 2. One kind of error: `ChatError`

Every failure (an HTTP 400, a dropped network, a timeout, a cancellation) is a `ChatError` with a specific `kind`. The benefit: the UI handles one error type and can ask `error.retryable` (does retrying make sense?) or `error.retryAfter` (how many seconds should I wait?).

## 3. Authentication without storing the token

```ts
bearerAuth({ getToken: () => auth.currentAccessToken() })
```

The SDK **does not keep** the token. It asks the host for it on every request. So:

- Refreshing the token is the host's job, and the SDK picks up the new one automatically.
- The SDK never puts the token in `localStorage` (where XSS could read it).

The test `adds auth headers per request and never caches the token` checks exactly this.

## 4. Cancellation and timeouts

`HttpClient.request` combines two `AbortSignal`s: the caller's signal (for example when the user keeps typing a search and the previous request becomes useless) and an internal timeout. It matters to tell them apart: a cancellation by the user is not an error (`kind: aborted` is not reported), but a timeout is.

## 5. The WebSocket as a state machine

A connection is not a `boolean`; it has several states the UI must show differently (diagram in [frontend.md](../../frontend.md#13-socket-socketts)). Modeling the states explicitly (`idle`, `connecting`, `open`, `reconnecting`, `offline`, `unauthenticated`, `closed`) prevents bugs such as "two simultaneous connections". There is also a `generation` counter: if `disconnect()` is called while a connection is opening, the earlier opening has no effect.

### Exponential backoff with full jitter

If the server restarts and 10,000 clients reconnect exactly one second later, the server falls over again (a **thundering herd**). The solution:

```
ceiling = min(max, min × 2^(attempt-1))     // 0.5s, 1s, 2s, 4s ... up to 30s
delay   = random() × ceiling                 // spread randomly over the whole range
```

This is called "full jitter" and is one of the most common patterns in distributed systems engineering. The test makes it deterministic with `random: () => 1`.

### Heartbeat: detecting a dead connection

If Wi-Fi drops, TCP may stay "open" for minutes because no close packet ever arrived (a **half-open connection**). So the client sends a `ping` every 30 seconds, and if no `pong` arrives within 10 seconds it closes the connection itself and reconnects. The same ping also renews the presence lease on the server. One mechanism, two uses.

### The browser's `offline` event

An E2E test revealed that Chromium does not close an open WebSocket when it goes offline. So the SDK closes the socket itself on the `offline` event, so the UI shows "offline" immediately, and reconnects right away (without waiting for backoff) on `online`.

## 6. An immutable store

Every change creates a new state object and keeps the unchanged parts as **the same references as before** (structural sharing):

```ts
return { ...s, conversations: { ...s.conversations, [id]: updated } };
```

Why? React (and any other UI) only needs to compare references (`===`) to know "did it change?", not the whole object. A component that listens only to conversation A does not re-render when conversation B changes.

## 7. Optimistic UI and reconciliation

Users expect their message to appear **immediately**, not after a network round trip. So the SDK creates a local message with status `pending` and `seq = Number.MAX_SAFE_INTEGER` (always at the end of the list). When the server's version arrives, `mergeMessages` finds the local copy by `client_id` and replaces it.

An important subtlety: the server's version arrives by **two paths**: the `ack` to the sender, and the `message.created` broadcast to everyone, the sender included. Their arrival order is not guaranteed. `mergeMessages` is written so the order does not matter (an **idempotent** operation on the client side). The test `the broadcast can arrive before the ack` covers this.

### Falling back from WebSocket to HTTP

```
if the socket is open      → message.send and wait for the ack (8 seconds)
if no ack or disconnected  → POST the same message with the same client_id
```

Because the server is idempotent, if the first message actually arrived, the POST returns that same message and nothing is duplicated. This is where the design of chapter 3 (idempotency) and chapter 6 (fallback) connect.

If the error is a validation error (a message that is too long, say), there is no fallback and the message becomes `failed`, because repeating it is pointless.

## 8. Recovery after a disconnect

When the socket reconnects (`ready.recovered === true`):

1. The conversation list is reloaded (unread counters, new conversations).
2. For each open conversation: `GET messages?after=<last seq>` (missed messages).
3. `GET messages?updated_since=<time of the previous connection>` (edits, deletions and reactions that happened during the outage).
4. Messages that failed because of the network are re-sent with the same `client_id`.

Separately, there is **gap detection** while connected: if `message.created` arrives with `seq = 10` while the last seen message was 7, `fetchGap` fetches messages 8 and 9.

The E2E test `goes offline, shows the banner, then recovers and catches up` runs this whole path with two real browsers.

## 9. Debounce and throttle

- `markRead`: a 250 ms debounce. If 20 messages arrive in a row, only one request is made.
- `setTyping`: a throttle; at most one `typing.start` every 3 seconds.

The difference: **debounce** means "wait until the events stop, then run once". **Throttle** means "run at most once every X seconds".

## 10. Dispose: complete cleanup

While working, the SDK creates timers, listeners, blob URLs and a socket. `dispose()` releases all of them. A small bug was found here: the `disposed` flag was set at the end of the function, so closing the socket during dispose sent one last update to the store. **Set the "finished" flag first.**

## Exercises

1. Read the test `reconnects with exponential backoff` and explain why it uses `vi.useFakeTimers()`.
2. Follow the `deliver` function in `client.ts` and list every path that ends in `status: 'failed'`.
3. Write a new `cookieTicketAuth` adapter that uses the session but fetches a ticket for the WebSocket (for a backend on another domain). Which fields of `AuthAdapter` are needed?
