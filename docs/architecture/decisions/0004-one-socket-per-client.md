# ADR 0004: One user-level WebSocket per client

## Status

Accepted (2026-11-19)

## Context

The legacy client opened one socket per room. Conversation lists, unread badges and an embeddable widget need events from every conversation at once; N sockets per tab multiply connection and presence bookkeeping.

## Decision

Clients open `/ws/chat/v1/`. On connect the consumer joins one channel-layer group per active membership (`rtchat.c.<id>`) plus a per-user group (`rtchat.u.<id>`). Membership changes are delivered on the user group (`conversation.updated` / `conversation.removed`), and the consumer joins or leaves the conversation group in response. A conversation-scoped endpoint is kept for embeds that only show one conversation.

## Consequences

- One connection per tab regardless of the number of conversations.
- Presence is reported per user across all shared conversations; a user online in many groups produces one event per shared conversation (clients treat them idempotently).
- The consumer keeps the set of subscribed conversations and ignores stale group deliveries after a removal.
