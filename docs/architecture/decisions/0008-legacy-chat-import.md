# ADR 0008: Keep legacy chat tables, import instead of migrating in place

## Status

Accepted (2026-11-19)

## Context

The legacy `chat` app's schema (slug rooms, timestamp ordering, an MTI `UserStatus` defect) could not become the reusable package's schema without rewriting migrations that existing databases have applied.

## Decision

The package ships new tables. The standalone server keeps the legacy `chat` app installed (models + migrations only, no routes) and provides `manage.py import_legacy_chat`, which reads legacy rows and writes package rows with deterministic IDs. Legacy tables are never modified. The old `/api/v1/` returns `410 Gone` with a migration hint.

## Consequences

- No destructive migration; rollback is possible by redeploying the previous version.
- The legacy API, consumer, template views, vendored static assets and the old `frontend/` were deleted (2026-11-19); they remain available in git history. Only the models, migrations, a read-only admin and the import command are left in `apps/server/chat`.
