# Chapter 11 — Packaging, CI and deployment

**English** · [فارسی](../11-packaging-and-ops.md)

## 1. A modern Python package

`packages/django-chat/pyproject.toml`:

- **src layout** (`src/django_realtime_chat/`): the package can only be imported after installation, so the tests exercise the installed version, not the current folder. That prevents "it works on my machine but file X is missing from the wheel" bugs.
- **Dependency version ranges** (`Django>=4.2,<6.0`): a package must not pin exact versions (`==`), or it clashes with the host project. Exact pins belong in the application (the server's `requirements.txt`), not the library.
- **extras** (`[redis]`, `[images]`, `[test]`): optional dependencies. Someone who does not want Redis does not install it.
- `py.typed`: tells type-checking tools this package has type hints.
- **Package data:** the translation files (`locale/*/LC_MESSAGES/*.po` and `.mo`) are listed in `package-data`, otherwise the wheel ships without Persian (chapter 13).
- `python -m build` produces both outputs: an `sdist` (source) and a `wheel` (ready to install).

## 2. An npm package with ESM

`packages/chat-client/package.json`:

```json
"type": "module",
"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
"sideEffects": false
```

- `exports` defines exactly what can be imported; internal files stay private.
- `sideEffects: false` lets bundlers **tree-shake** (drop unused code). In the React library, only the CSS files have side effects.
- **peerDependencies** for React: a library must not bring its own copy of React. Two copies of React on one page means the error "A React Element from an older version". That is exactly what happened in this project, when npm put version 19 at the root while the package had version 18.

### The `.js` extension in imports

```ts
import { ChatError } from './errors.js';   // in a .ts file!
```

It looks odd, but standard ESM in Node does not guess extensions, and TypeScript does not rewrite imports. Bundlers (Vite) work without the extension, so this bug only shows up when the package is imported in plain Node, which is exactly what `verify-packages.sh` tests.

## 3. npm workspaces

One `package-lock.json` and one `node_modules` at the root. The packages are linked with symlinks. The common problem here is **several versions of one dependency** (React 18 and 19, Vite 5 and 6). The fix: pin the shared version in the root `devDependencies` so a single version is hoisted, and check with `npm ls react`.

## 4. Docker

`Dockerfile`:

- The `python:3.12-slim` image, with `PYTHONDONTWRITEBYTECODE` and `PYTHONUNBUFFERED` (logs show up immediately).
- First only `requirements.txt` and the package are copied, then the rest of the code. That way the dependency-install layer stays cached as long as the requirements have not changed, and builds are fast.
- The requirements are installed **from `apps/server`** (`cd apps/server && pip install -r requirements.txt`), because the relative editable path inside the file resolves against the current directory (bug 13 in chapter 12).
- A non-root user (`useradd … talkio`): if the app is compromised, the attacker does not become root in the container.
- A `HEALTHCHECK` on `/api/health/`.

`docker-compose.yml` for development: Postgres and Redis with healthchecks, and the server with `depends_on: condition: service_healthy`. The server does not start until the database is actually ready, not just until its container is up.

## 5. CI (`.github/workflows/ci.yml`)

- **Matrix:** the package on Django 4.2 and 5.2, and on SQLite and PostgreSQL (as a service container).
- **`makemigrations --check`:** if someone changes a model without creating a migration, CI fails.
- **`check --deploy`** with `DEBUG=0`: production security warnings.
- **Translation checks:** `python scripts/i18n.py check` and `npm run i18n:check` fail if a string has no Persian translation or a `.mo` file is stale (chapter 13).
- **`concurrency`:** a new push cancels the previous run of the same branch.
- **Traces on failure:** the Playwright report is uploaded as an artifact so a failure can be investigated.

An old bug: the previous CI was configured for a `src/` folder that did not exist, so it **never** passed. A CI that is always red is worse than no CI, because everyone learns to ignore it.

## 6. Production settings

Read [deployment.md](../../deployment.md) in full. The key points worth learning:

- **Fail fast:** without `DJANGO_SECRET_KEY` and with `DEBUG=0`, the server refuses to start, instead of silently running with an insecure default key.
- **Twelve-factor:** every environment-specific setting is read from an environment variable (`.env.example` is the full list). The code is the same in dev and production.
- **Redis for more than one process:** process memory is not shared between workers; presence, throttling and one-time tickets only work correctly in a single process without Redis. System check `W002` reminds you of this.
- **`TRUSTED_PROXY_COUNT`:** chapter 5.
- **A request size limit on the proxy:** Daphne writes the whole request body to disk before it reaches Django. So multi-gigabyte uploads must be stopped at nginx or the platform's proxy.
- **Two healthchecks:** `/api/health/` (the process is alive) versus `/api/health/ready/` (the database and Redis are reachable). The load balancer should send traffic only to "ready" instances.

## Exercises

1. Run `./scripts/verify-packages.sh`. Then temporarily remove the extension from one of the SDK's `.js` imports, build, and run it again.
2. Check with `npm ls react` and `npm ls vite` that only one version of each is installed.
3. Design a `render.yaml` that defines the web service and the required environment variables. Which variables are secrets?
