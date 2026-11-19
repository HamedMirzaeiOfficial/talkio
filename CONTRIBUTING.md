# Contributing

## Local development

See the README quick start. Work on a branch named `<username>/<topic>`; never commit directly to `main`.

## Before opening a pull request

- Python: `ruff check . && ruff format --check .` and `pytest` in `packages/django-chat` and `apps/server` (`DEBUG=1`).
- JavaScript/TypeScript: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`.
- Behavior changes in the UI or transport: run the Playwright suite (`apps/web`).
- Add a regression test for every behavior change, especially authorization, idempotency and reconnect paths.
- Migrations must be additive and backward compatible; check with `makemigrations --check`.
- Keep business rules in `django_realtime_chat/services/` and state handling in `@realtime-chat/client`; React components stay presentational. Do not duplicate chat logic in `apps/`.
- Update `docs/api/` whenever a REST or WebSocket contract changes, and add an ADR for architectural decisions.
- New user-facing text is translated: `t('…')` in `apps/web` (Persian in `src/locales/fa.json`, check with `npm run i18n:check -w @talkio/web`), a `ChatStrings` key in the React library (with its `faStrings` entry), `gettext()` on the server (then `python scripts/i18n.py extract`, fill the `.po`, `compile`, `check`). Use logical CSS (`ps/pe`, `start/end`) so the layout mirrors.
- Persian copies of the docs live in `docs/fa/` (and the English tutorial in `docs/learn/en/`); update them too when you can, or say so in the pull request.
- Never commit secrets, local databases, media or build output.

## Commits

Small, focused commits with a clear reason (Conventional Commits style: `feat:`, `fix:`, `docs:` …).
