# ADR 0003: Per-conversation sequence numbers

## Status

Accepted (2026-11-19)

## Context

The legacy cursor was a timestamp. Messages with equal timestamps could be skipped or repeated between pages, clients could not tell whether they missed messages after a reconnect, and unread counts required a per-message `seen_by` table that was never maintained.

## Decision

Every message gets `seq`, a gap-free integer per conversation. It is assigned inside the creating transaction by `UPDATE conversation SET last_seq = last_seq + 1` followed by reading the value back; the UPDATE's row lock serializes concurrent senders on PostgreSQL (SQLite serializes writers anyway). `UNIQUE(conversation, seq)` guards the invariant. Read state is one integer per membership (`last_read_seq`).

## Consequences

- Stable cursors (`before`/`after` a seq) and cheap gap detection on the client.
- Unread count = non-deleted messages from others with `seq > last_read_seq` (an indexed range count).
- Message creation in one conversation is serialized at the row lock. This is a deliberate throughput ceiling per conversation (not per system); it is acceptable for chat-sized conversations and is documented as a limitation. No benchmark numbers are claimed.
- A rolled-back send (e.g. invalid attachment) does not leave a gap, because the increment rolls back with it.
