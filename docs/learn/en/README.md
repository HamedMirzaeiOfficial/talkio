# Talkio learning guide

**English** · [فارسی](../README.md)

This guide is written for **study**, not as a quick reference. Its goal is to teach software engineering concepts in depth by reading the real code of this project: why each decision was made, what the alternatives were, and which bugs turned up along the way.

> Precise technical reference: [backend.md](../../backend.md) and [frontend.md](../../frontend.md). API contracts: [rest-api.md](../../api/rest-api.md) and [websocket.md](../../api/websocket.md).

## Prerequisites

- Python and the basics of Django (models, views, migrations)
- JavaScript/TypeScript and the basics of React (components, hooks, state)
- HTTP and Git

You do not need to know Channels, WebSocket, Tailwind or Playwright; the chapters explain them.

## Chapters

| # | Chapter | Main topic |
| --- | --- | --- |
| 1 | [The architecture map](01-architecture.md) | monorepo, layers, why three packages |
| 2 | [A reusable Django package](02-reusable-django-app.md) | `AUTH_USER_MODEL`, settings, system checks, policy and adapter |
| 3 | [Data, transactions and concurrency](03-data-and-concurrency.md) | constraints, `seq`, row locks, idempotency, `on_commit` |
| 4 | [Real-time communication](04-realtime.md) | ASGI, Channels, groups, protocol design, presence |
| 5 | [Security](05-security.md) | session/CSRF, tickets, origins, rate limits, safe uploads, XSS |
| 6 | [The TypeScript SDK](06-typescript-sdk.md) | state machine, backoff, store, optimistic UI, recovery |
| 7 | [React and the component library](07-react-library.md) | `useSyncExternalStore`, StrictMode, scrolling, accessibility |
| 8 | [CSS, design and isolation](08-css-and-design.md) | specificity, cascade layers, tokens, RTL |
| 9 | [Media: emoji, stickers, voice, files](09-media.md) | Unicode and graphemes, fonts versus images, MediaRecorder |
| 10 | [Testing](10-testing.md) | test pyramid, fakes, transactional tests, concurrency, Playwright |
| 11 | [Packaging, CI and deployment](11-packaging-and-ops.md) | `pyproject`, ESM, Docker, CI, production settings |
| 12 | [Lessons from bugs](12-bug-stories.md) | real bugs of this project and the lesson of each |
| 13 | [Going bilingual](13-i18n.md) | translating a library versus an app, gettext, socket language, `<bdi>` |

## Suggested reading order

1. Read chapter 1 and run the project with the Quick start in the README. Send messages with two users in two browsers.
2. Read chapters 2 to 5 (backend) in order, each time with the files they mention open next to you.
3. Read chapters 6 to 9 (frontend), then chapter 13.
4. Read chapter 10 and run the tests yourself; break a test on purpose and see what happens.
5. Read chapter 12 last; after you have seen the code, the bug stories mean more.

Every chapter ends with a few **exercises**. Actually do them; that is where most of the learning happens.

## How to read the code

- **Start from the contracts, not the details.** Read [websocket.md](../../api/websocket.md) first, then `ws/consumer.py`.
- **Follow one request end to end.** For example, follow "send a message" from the Send button in `MessageComposer.tsx` to `services/messages.py::_create` and back as `message.created`.
- **Tests are executable documentation.** When you are unsure what a function does exactly, read its test.
