# Chapter 12 — Bug stories and their lessons

**English** · [فارسی](../12-bug-stories.md)

These are **real** bugs from this project, found and fixed during the build. Each one is a recurring pattern in software engineering.

---

### 1. The ghost user (`UserStatus`)

**What it was:** the old model `class UserStatus(User)` both inherited from `User` (multi-table inheritance) and had a `OneToOneField` to `User`. Every `get_or_create` for a user also created a **new** row in the users table (the inheritance parent).

**Lesson:** model inheritance in Django means a join and a row in the parent table. For "extra information about a user", use a `OneToOneField`, not inheritance.

### 2. The cursor that broke on `+`

**What it was:** the conversation pagination cursor was `2026-…+00:00|uuid`. In a query string, `+` turns into a space and `fromisoformat` fails.

**Lesson:** make cursors **opaque** (base64url). The client must not know or depend on their internal structure.

### 3. A reverse accessor clash

**What it was:** `related_name="chat_attachments"` existed both in the new package and in the old app; `manage.py check` raised `fields.E304`.

**Lesson:** reusable code needs a prefix in every shared namespace.

### 4. A storage that ignored the settings

**What it was:** the callable passed to `FileField(storage=...)` runs once at import time; the tests wrote files to the real disk.

**Lesson:** for every configuration hook, know whether it runs "once at import" or "on every use". `LazyObject` + the `setting_changed` signal.

### 5. `dispose` that sent one last update

**What it was:** the `disposed` flag was set at the end of the function; closing the socket during dispose published a state change.

**Lesson:** set the "shutting down" flag **first**.

### 6. A React Element from an older version

**What it was:** because of a peer dependency, npm installed React 19 at the root while the package had React 18. Two versions, one page.

**Lesson:** in a monorepo, check for duplicate versions with `npm ls <pkg>` and pin the shared version at the root.

### 7. StrictMode and the dead client

**What it was:** the client was created with `useMemo` and destroyed in an effect's cleanup. StrictMode destroyed it and then reused the same dead client. The app started but showed no data.

**Lesson:** create a resource in the same effect that cleans it up. Tool: `useCreateChatClient`. Only an E2E test found this bug.

### 8. Every padding became zero

**What it was:** `@import`s are moved to the top of the file, so the reset ended up after the utilities and won with equal specificity.

**Lesson:** order matters in the cascade; and **look** at the visual output. No unit test caught this.

### 9. Georgia inside the widget

**What it was:** the host's `* { font-family }` applied directly to every element and beat inheritance. The first test checked only the root element.

**Lesson:** an explicit rule, even with zero specificity, beats inheritance. And a test must **check the place the user actually sees.**

### 10. A `.gitignore` that hid code

**What it was:** the `media` pattern also matched `src/components/media/`; Tailwind did not scan it and git ignored it too.

**Lesson:** anchor ignore patterns (`/apps/server/media/`). A test was also added that fails if that folder's classes are missing from the CSS.

### 11. Bypassing the rate limit with `X-Forwarded-For`

**What it was:** without `NUM_PROXIES`, DRF trusted the header the client sends; the sign-in attempt cap was useless.

**Lesson:** any client input, headers included, can be forged. Configure the proxy chain of trust explicitly and prove it with an attack-driven test.

### 12. A guess that turned out wrong

**What it was:** I assumed adding the same member concurrently had a race. A real test on PostgreSQL showed that the implicit `FOR UPDATE` lock on the joined row serializes it. **There was no bug.**

**Lesson:** do not guess about concurrency; measure. And document and test the behavior the code's correctness relies on, so nobody breaks it unknowingly.

### 13. A relative path that worked in only one job

**What it was:** `apps/server/requirements.txt` installs the chat package with `-e ../../packages/django-chat`. The "Standalone server" CI job ran from the `apps/server` folder and was green, but the end-to-end job (Playwright) installed the same file from the repository root and failed: `is not a valid editable requirement`. The `Dockerfile` had the same problem (it installed from `/app`).

**Lesson:** pip resolves relative paths inside a requirements file against the **current directory**, not against the file itself. A command run from two different places needs testing in both. The fix: install from `apps/server` (`working-directory` in CI and `cd` in the Dockerfile).

### 14. A lazy translation in JSON

**What it was:** the errors' default message was made translatable with `gettext_lazy`, and the WebSocket consumer failed with `TypeError: Object of type __proxy__ is not JSON serializable`. (Chapter 13)

**Lesson:** a lazy object must become a string before it reaches a system boundary (JSON, logs, queues); the best place is the moment the error is created.

### 15. The exclamation mark that moved

**What it was:** the preview "You: Thanks Farnaz, see you there!" was displayed in the Persian UI as `!Thanks Farnaz, see you there :شما`. (Chapter 13)

**Lesson:** put user text of unknown language inside `<bdi>` next to UI text, and do not glue strings of different directions together before rendering.

---

## Common patterns

1. **Database constraints, not just application code** (2 and 3 in chapter 3).
2. **Order and timing** cause most strange bugs: the CSS cascade, tool hooks, `on_commit`, StrictMode, flaky tests.
3. **Each test layer catches something the others miss**, especially E2E and looking at screenshots.
4. **Client input is never trustworthy:** Content-Type, X-Forwarded-For, user ids, message text.
5. **Prefixes and isolation** for code that lives in someone else's house.
6. **Every fixed bug gets a regression test.** Everything above now has one.

## Final exercise

Pick one of these bugs, temporarily revert its fix (`git stash` or a manual edit), and see **which test** fails. If no test fails, write one. This is the best way to understand the value of regression tests.
