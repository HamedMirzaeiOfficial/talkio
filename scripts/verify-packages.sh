#!/usr/bin/env bash
# Build all distributable packages and install them the way a third party would.
# Python: wheel into a fresh venv, then run the external Django example against it.
# npm: `npm pack` tarballs into a throwaway project outside the workspace, then
#      strict-typecheck a consumer file and import the packages under plain Node.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PY="${PYTHON:-python3}"

echo "==> Python package"
(cd "$ROOT/packages/django-chat" && rm -rf dist && "$PY" -m build >/dev/null)
"$PY" -m venv "$WORK/venv"
"$WORK/venv/bin/pip" install -q "$ROOT"/packages/django-chat/dist/*.whl daphne pytest pytest-django pytest-asyncio
(cd "$ROOT/examples/django-integration" && "$WORK/venv/bin/pytest" -q -p no:cacheprovider)

echo "==> npm packages"
(cd "$ROOT" && npm run build:packages >/dev/null && npm pack -w @realtime-chat/client -w @realtime-chat/react --pack-destination "$WORK" >/dev/null)
mkdir -p "$WORK/consumer/src"
cd "$WORK/consumer"
echo '{ "name": "consumer", "private": true, "type": "module" }' > package.json
npm install --silent --no-audit --no-fund "$WORK"/realtime-chat-client-*.tgz "$WORK"/realtime-chat-react-*.tgz react@19 react-dom@19 @types/react@19 typescript@5.7
cat > src/app.tsx <<'TSX'
import { bearerAuth, createChatClient } from '@realtime-chat/client';
import { ChatProvider, ChatWidget, ChatWindow } from '@realtime-chat/react';
const client = createChatClient({ baseUrl: 'https://chat.example.com/api/chat/v1', wsUrl: 'wss://chat.example.com/ws/chat/v1', auth: bearerAuth({ getToken: () => null }) });
export const App = () => (<ChatProvider client={client}><ChatWindow conversationId="x" /><ChatWidget /></ChatProvider>);
TSX
echo '{ "compilerOptions": { "strict": true, "jsx": "react-jsx", "module": "ESNext", "moduleResolution": "Bundler", "target": "ES2022", "noEmit": true, "lib": ["ES2022","DOM"] }, "include": ["src"] }' > tsconfig.json
npx tsc -p .
node --input-type=module -e "await import('@realtime-chat/client'); await import('@realtime-chat/react'); console.log('ESM imports OK')"
test -f node_modules/@realtime-chat/react/dist/styles.css
echo "All packages verified."
