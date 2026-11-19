# Talkio web app

React + Vite app built on `@realtime-chat/client` and `@realtime-chat/react`. It adds routing, auth screens, layout, settings and notifications — no chat components of its own.

```bash
npm install && npm run build:packages     # from the repository root
npm run dev -w @talkio/web                # http://127.0.0.1:4801, proxies to the server on :4800
npx playwright test --project=desktop --project=mobile   # servers running; PLAYWRIGHT_CHROMIUM_PATH for a custom browser
```
