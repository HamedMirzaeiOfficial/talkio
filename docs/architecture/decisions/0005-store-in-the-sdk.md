# ADR 0005: The reactive store lives in the framework-independent SDK

## Status

Accepted (2026-11-19)

## Context

Chat state (optimistic messages, reconciliation by `client_id`, gap recovery, unread counters, typing expiry, presence) is the hardest part of a chat client. If it lived in React components, it would be duplicated for every framework and coupled to one data-fetching library.

## Decision

`@realtime-chat/client` owns a normalized, immutable store with `subscribe()`/`getState()` and pure reducers. `@realtime-chat/react` binds to it with `useSyncExternalStore` and selector hooks. The library does not depend on TanStack Query; the standalone app uses TanStack Query for app-level data (session, profiles).

## Consequences

- Vue/Svelte/vanilla hosts can use the SDK alone with the same behavior.
- The React library has no peer dependency on a specific query library version.
- The store is unit-tested without a DOM.
