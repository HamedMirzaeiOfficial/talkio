# Architecture Guide

Real-time Chat is a Django monolith with two transport paths: normal Django requests for page rendering and Channels over ASGI for live events. Both paths are expected to use the same domain services and authorization rules.

The durable system of record is the relational database. Redis is a transport/ephemeral-state dependency, not the source of truth for messages. If a browser disconnects, it recovers persisted messages using history pagination after reconnecting.

See [current-state.md](current-state.md) for the audited baseline and [proposed-design.md](proposed-design.md) for the staged target design.
