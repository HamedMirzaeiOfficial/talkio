# Talkio server

Standalone Django project: settings, `accounts` (user model + `/api/auth/`), the legacy `chat` app (import source only) and the reusable `django_realtime_chat` package.

```bash
pip install -r requirements-dev.txt
DEBUG=1 python manage.py migrate && DEBUG=1 python manage.py seed_demo
DEBUG=1 daphne -b 127.0.0.1 -p 4800 core.asgi:application
DEBUG=1 pytest
```

Commands: `seed_demo` (dev only), `import_legacy_chat [--dry-run]`, `chat_purge_uploads`. See `docs/deployment.md`.
