# Chapter 10 — Testing

**English** · [فارسی](../10-testing.md)

## 1. This project's test pyramid

```
                 ┌──────────────────────┐
                 │  E2E (Playwright) 15 │  real browser, real server
               ┌─┴──────────────────────┴─┐
               │ Component (RTL + jsdom) 26│  React + real SDK + fake network
             ┌─┴──────────────────────────┴─┐
             │ SDK (Vitest) 25              │  no DOM
           ┌─┴──────────────────────────────┴─┐
           │ Backend (pytest) ~140            │  real database (SQLite/Postgres)
           └──────────────────────────────────┘
```

Each layer catches something the others miss. In this project:

| Bug | Which layer found it |
| --- | --- |
| Cursor broken by `+` | backend API test |
| `dispose` sent one last update | SDK test |
| Focus after Reply | component test |
| Dead client in StrictMode | **E2E only** |
| Every padding removed | **screenshots only** |
| Host font inside the widget | **screenshots + a strengthened E2E only** |
| Rate limit bypass | a targeted security test |

**The lesson:** high code coverage from unit tests does not catch integration and visual bugs. Always **look** at your screenshots.

## 2. Fakes versus mocks

The SDK and React tests use **fakes**, not mocks:

- `FakeWebSocket` (`packages/chat-client/test/fakes.ts`): a real but controllable WebSocket implementation, with server-side methods (`ready()`, `emit()`, `serverClose(code)`).
- `fakeFetch(routes)`: a routing table that returns real `Response` objects.

The difference: a mock checks "was this function called with this argument?", which ties the test to implementation details. A fake simulates a **behavior**, and the test checks the outcome ("the message is in the list with status sent"). The React tests use a **real ChatClient** on top of these fakes, so the SDK's logic is tested at the same time.

## 3. Backend tests

- **Django's standard user:** `tests/settings.py` uses `auth.User`. That proves the package does not depend on a specific user model.
- **`on_commit`:** see chapter 3 (`django_capture_on_commit_callbacks` or `transaction=True`).
- **WebSocket:** Channels' `WebsocketCommunicator`. A trap: when `receive_json_from(timeout=…)` times out, it **cancels the whole consumer** (asgiref behavior) and later tests fail with a strange `CancelledError`. To check "no message arrived", `receive_nothing()` is used (the `none_of` helper).
- **Malformed input:** a list of broken inputs is tested with `pytest.mark.parametrize` (`test_malformed_user_ids_are_rejected_not_500`).
- **Translations:** `tests/test_i18n.py` checks Persian error messages over REST and WebSocket (chapter 13).

## 4. Testing real concurrency

SQLite serializes every write, so concurrency tests are meaningless on it. PostgreSQL is needed. On a server without Docker or sudo, the `pgserver` package runs a real PostgreSQL in user space:

```python
import pgserver
srv = pgserver.get_server("/tmp/pgdata")
print(srv.get_uri())   # postgresql://postgres:@/postgres?host=/…socket
```

```bash
TEST_DATABASE_URL="<uri>" pytest
```

`tests/test_concurrency.py` releases all threads at the same instant with `threading.Barrier` (so they are truly concurrent); each thread has its own database connection and calls `connection.close()` at the end. What is checked:

- 8 concurrent requests to create a direct conversation, from both sides → exactly one conversation.
- 6 senders × 10 messages + a retry of every message → `seq`s 1 to 60 with no gaps and no duplicates.
- Two admins adding the same member at the same time → one membership row.

To make sure the result was not luck, these tests were run several times in a row.

## 5. Playwright (E2E)

- **Two browsers = two users:** `userPage(browser, 'alice')` creates a separate context (separate cookies). The real-time delivery test really works with two sessions.
- **Real offline:** `context.setOffline(true)` → offline banner → the other user sends a message → `setOffline(false)` → the missed message appears.
- **A fake microphone:** Chromium flags in `playwright.config.ts`.
- **Accessible locators:** `getByRole('button', { name: 'Send voice message' })`.

### Flaky tests and their root causes

| Symptom | Real cause | Fix |
| --- | --- | --- |
| Sticker count "5 instead of 1" | the "before" count was taken while the history had not loaded yet | the `openConversation` helper waits for the history to load (`aria-busy=false`) |
| "Enter sends" test failing 1 in 5 | the ack timeout in the test helper was only 50 ms | 2000 ms |
| `hasText: 'Ship it 🚀'` not found | emoji are now `<img alt>` and `hasText` does not read alt text | search with `getByRole('img', { name: '🚀' })` |

**The lesson:** do not hide a flaky test behind `retry`. Its root cause is almost always a wrong assumption about **timing** or **state**.

## 6. Screenshots as visual tests

`e2e/screenshots.spec.ts` produces the README screenshots from the real app, including the Persian (RTL) versions. Several visual bugs were found only this way (chapter 8). A good next step would be comparing them against a reference image (`toHaveScreenshot`) so an unintended change in appearance fails CI.

## 7. Testing packages from the consumer's point of view

`scripts/verify-packages.sh`:

1. Builds the Python wheel, installs it into a **clean** venv and runs the `examples/django-integration` tests against it.
2. Turns the npm packages into tarballs with `npm pack`, installs them in an empty project **outside** the workspace, typechecks with `skipLibCheck: false` and imports them in plain Node.

This catches bugs invisible inside the monorepo: a file missing from `files`, a broken `.d.ts`, or an import without a `.js` extension that does not work in real ESM.

## Exercises

1. Start PostgreSQL with `pgserver` and run the whole package test suite against it.
2. Write an E2E test proving that a message edited while the other user was offline reaches them after they reconnect (the `updated_since` path).
3. Write a component test with a `fakeFetch` that returns a 429 and check that the message becomes `failed` and has a Retry button.
