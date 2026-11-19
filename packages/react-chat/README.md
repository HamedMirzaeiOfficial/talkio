# @realtime-chat/react

Accessible, themeable React components and an embeddable `<ChatWidget/>` for `django-realtime-chat`, built on `@realtime-chat/client`.

```tsx
import '@realtime-chat/react/styles.css';
<ChatProvider client={client}><ChatWidget /></ChatProvider>
```

Styles are isolated (prefixed utilities, `--rc-*` tokens, reset scoped to `.rc-root`). Docs: `docs/integration/react.md`, `docs/design-system.md`. Build: `npm run build` (JS, types, CSS). Tests: `npm test`.
