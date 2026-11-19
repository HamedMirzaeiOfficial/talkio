# Using the TypeScript SDK and React components

Working example: [`examples/react-integration`](../../examples/react-integration) — an existing app with opinionated global CSS that embeds `<ChatWidget/>` on top of its own Django session.

```bash
npm install @realtime-chat/client @realtime-chat/react
# peers: react >= 18.2, react-dom >= 18.2
```

## 1. Create a client

```ts
import { bearerAuth, createChatClient, sessionAuth } from '@realtime-chat/client';

// Same-site Django session (default): cookies + X-CSRFToken from the csrftoken cookie.
const client = createChatClient({
  baseUrl: '/api/chat/v1',
  wsUrl: '/ws/chat/v1',
  auth: sessionAuth({ onUnauthorized: () => location.assign('/login') }),
});

// Token auth: the SDK asks your code for the token on every request and never stores it.
const tokenClient = createChatClient({
  baseUrl: 'https://chat.example.com/api/chat/v1',
  wsUrl: 'wss://chat.example.com/ws/chat/v1',
  auth: bearerAuth({ getToken: () => auth.currentAccessToken() }), // also enables WS tickets
});
```

`AuthAdapter` is a small interface (`credentials`, `getHeaders()`, `useSocketTicket`, `onUnauthorized()`); write your own for other schemes.

## 2. Render components

```tsx
import '@realtime-chat/react/styles.css';
import { ChatProvider, ChatWindow, ConversationList, useCreateChatClient } from '@realtime-chat/react';

function Messages({ conversationId, onOpen }: { conversationId?: string; onOpen: (id: string) => void }) {
  // Creates the client for this component's lifetime; StrictMode-safe; disposes on unmount.
  const client = useCreateChatClient(() => createChatClient({ baseUrl: '/api/chat/v1', wsUrl: '/ws/chat/v1' }), []);
  if (!client) return null;
  return (
    <ChatProvider client={client}>
      <div style={{ display: 'flex', height: '100%' }}>
        <ConversationList activeId={conversationId} onSelect={(c) => onOpen(c.id)} getHref={(c) => `/messages/${c.id}`} />
        <ChatWindow conversationId={conversationId} />
      </div>
    </ChatProvider>
  );
}
```

The components never navigate. Pass `onSelect`/`getHref`/`onBack` and drive them from your router.

Or embed everything at once:

```tsx
<ChatProvider client={client} tokens={{ primary: '#0f766e', 'bubble-out': '#0f766e' }}>
  <ChatWidget position="bottom-right" title="Support" />
</ChatProvider>
```

`ChatWidget` supports controlled `open`/`onOpenChange` and `conversationId`/`onConversationChange`, `position`, `offset`, `zIndex`, `launcherLabel`, `allowNewConversations`. It becomes full-screen below 640 px and closes with Esc.

## Components

| Component | Purpose |
| --- | --- |
| `ChatProvider` | Supplies the client, theme, preferences (controlled or persisted), strings, tokens, `onError` |
| `ChatWindow` | Header + connection banner + message list + typing + composer + forward dialog |
| `ChatWidget` | Floating launcher with unread badge and a list → conversation panel |
| `ConversationList` / `ConversationItem` | Searchable, keyboard-navigable list with unread badges, typing and previews |
| `ConversationHeader` | Title, presence or member count, typing, back/info actions |
| `MessageList` | Infinite scroll with stable scroll position, day separators, grouping, unread divider, jump-to-latest, read ticks, auto mark-read |
| `MessageBubble` / `MessageText` | Inert text with auto direction and safe links; context menu (react, reply, copy, edit, pin, forward, delete); retry/discard for failed sends |
| `MessageComposer` | Auto-growing textarea, drafts per conversation, Enter/Ctrl+Enter, paste and drag-drop files, emoji & sticker picker, voice recording (Esc cancels), validation against server limits, reply/edit modes, typing signals |
| `TypingIndicator`, `PresenceIndicator`, `UnreadBadge`, `UserAvatar` | Small building blocks |
| `AttachmentPreview` | Images (lightbox), audio, video, files with download and upload progress |
| `GroupMemberList`, `ConversationInfoPanel` | Members with roles and admin actions, pinned messages, edit details, leave |
| `ChatSearch` | Server-side message search with highlighting |
| `ChatSettings` | Theme, Enter-to-send, compact mode |
| `NewConversationDialog`, `AddMembersDialog`, `ForwardDialog`, `UserPicker` | Discovery and creation flows |
| `ConnectionBanner` | Reconnecting / offline / signed-out states with "Retry now" |
| `EmojiPicker` | Searchable picker over the full Unicode set (data loaded lazily on first open), categories, recents |
| `StickerPicker`, `StickerImage` | Server sticker packs; used by the composer's emoji button |
| `VoicePlayer`, `useVoiceRecorder` | Waveform player with seeking and 1×/1.5×/2× speed; MediaRecorder-based recording with live levels |

## Hooks

`useChatClient`, `useChatState(selector)`, `useConversations`, `useConversation(id)`, `useMessages(id)` (loads on first use), `useTypingUsers(id)`, `usePresence(userId)`, `useConnection`, `useUnreadTotal`, `useChatConfig`, `useMe`, `useUserSearch(q)`, `useAttachmentUrl(attachment)`, `useCreateChatClient(factory, deps)`.

## SDK without React

```ts
await client.start();                         // config + conversations + socket
const off = client.subscribe(() => render(client.getState()));
await client.loadMessages(id);
await client.sendMessage(id, { body: 'Hi', files: [file] });
await client.sendMessage(id, { voice: { file, duration: 3.2, waveform } });
await client.loadStickers(); // state.stickers.packs
await client.sendMessage(id, { sticker: client.getState().stickers.packs[0]!.stickers[0]! });
client.on('incoming', ({ message }) => notify(message));
client.on('connection', (state) => console.log(state.status));
client.dispose();
```

`client.api` exposes every REST endpoint with `AbortSignal` support; `client.socket` is the connection manager (`state`, `reconnectNow()`); errors are `ChatError` (`kind`, `code`, `status`, `details`, `retryAfter`, `retryable`).

## Styling and theming

- Import `@realtime-chat/react/styles.css` once. It contains only prefixed utilities (`.rc\:*`), tokens on `.rc-root`, and a reset scoped to `.rc-root` — no global rules. Your Tailwind/Bootstrap setup is unaffected.
- Theme with `<ChatProvider tokens={{ … }}>` (inline `--rc-*` variables) or with CSS:

```css
.rc-root { --rc-primary: #0ea5e9; --rc-radius: 6px; --rc-font: 'IBM Plex Sans', sans-serif; }
.rc-root[data-rc-theme='dark'] { --rc-bg: #000; }
```

- `preferences.theme`: `'system' | 'light' | 'dark'`. Token list: [design-system.md](../design-system.md).
- Emoji: pass `<ChatProvider emoji={{ baseUrl: '/emoji' }}>` and serve the SVGs of `@twemoji/svg` (CC-BY 4.0, attribution required) at that URL to render emoji as images, identical on every OS and independent of installed fonts (the standalone app copies them in `apps/web/vite.config.ts`). Without the option, native emoji text is used.
- Fonts are not bundled: load Inter and Vazirmatn (or override `--rc-font` / `--rc-font-rtl`).
- Text in `strings` can be overridden for localization (`<ChatProvider strings={{ send: 'ارسال' }}>`).
