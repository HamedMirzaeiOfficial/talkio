# ADR 0002: At-Least-Once Delivery with Idempotent Writes

## Status

Accepted

## Decision

Treat WebSocket delivery as at-least-once. Require a client request ID for message creation and enforce uniqueness per sender/conversation. Clients deduplicate canonical server messages.

## Rationale

WebSockets do not provide exactly-once application delivery across reconnects and process failures. Durable idempotency is simpler and more honest than promising exactly-once semantics.

## Consequences

The database schema and client protocol carry idempotency metadata. Old clients can be supported temporarily with a compatibility path, but new clients should always send request IDs.
