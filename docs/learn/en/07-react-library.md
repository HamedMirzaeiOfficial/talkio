# Chapter 7 — React and the component library

**English** · [فارسی](../07-react-library.md)

Files for this chapter: `packages/react-chat/src/{context.tsx,hooks.ts}`, `components/MessageList.tsx`, `components/MessageComposer.tsx`, `components/MessageBubble.tsx`, `components/primitives.tsx`

## 1. Connecting the store to React: `useSyncExternalStore`

React 18 has a dedicated hook for reading from an external store:

```ts
useSyncExternalStore(client.subscribe, getSnapshot)
```

This hook guarantees that every component sees the same version of the state within one render (preventing **tearing** in concurrent rendering).

A subtlety: `getSnapshot` must return **the same value** for the same state, otherwise React thinks something always changed and falls into an infinite loop. That is why `useChatState(selector)` memoizes its result. `useStableArray` goes one step further: if the selector returns a **new** array with the same items (as `filter` does), the previous array is returned.

## 2. The StrictMode lesson: who owns a resource?

In development, React StrictMode deliberately runs every effect **twice** (mount, unmount, mount) to expose code without proper cleanup. The app's original code was:

```tsx
const client = useMemo(() => createAppChatClient(), [userId]);
useEffect(() => () => client.dispose(), [client]);
```

StrictMode: mount, then cleanup (the client is disposed!), then mount again **with the same dead client**, because `useMemo` kept its value. The result: the app loaded but showed no conversations. An E2E test found this, not a unit test.

The right way: create the resource **inside** the effect and destroy that same instance in the cleanup:

```ts
export function useCreateChatClient(factory, deps) {
  const [client, setClient] = useState(null);
  useEffect(() => {
    const instance = factory();
    setClient(instance);
    return () => instance.dispose();
  }, deps);
  return client;
}
```

Each mount has its own client and each cleanup destroys its own client. This hook was added to the library so every host is safe from this trap, and it has a dedicated StrictMode test.

**The lesson:** always make explicit "who creates the resource and who destroys it". `ChatProvider` deliberately does **not** dispose the client, because it does not own it.

## 3. Context for global things

`ChatProvider` holds what every component needs: the client, the theme, the UI strings (for translation), the color tokens and the emoji image URLs. A performance point: `value` is built with `useMemo`; otherwise every parent render would re-render all consumers.

## 4. The message list: the hardest component

### Keeping the scroll position while loading older messages

When the user scrolls up and 50 older messages are added **above** the list, the visible content jumps down. The fix lives in `useLayoutEffect` (which runs before paint, so the user never sees the jump):

```ts
if (first !== previous.first && last === previous.last) {      // prepended
  el.scrollTop += el.scrollHeight - prevHeight;
}
```

Browsers have a feature called **scroll anchoring** that does this automatically. If both are active, the correction is applied twice. So `overflow-anchor: none` is set and the control is manual.

### Sticking to the bottom, but not always

A new message arrives. If the user is at the bottom of the list, scroll. If they have scrolled up and are reading history, **do not scroll** (it is very annoying) and show a "3 new messages" button instead. Exception: if the message is the user's own, always scroll.

### The "new messages" divider

When a conversation opens, `my_last_read_seq + 1` is snapshotted **once**. If the live state value were used, the divider would vanish as soon as the conversation was marked read.

## 5. The composer: details that make it professional

- **IME:** users typing with a Persian, Chinese or Japanese keyboard press Enter to confirm a word. `event.nativeEvent.isComposing` is checked so half a message is not sent.
- **A draft per conversation:** a module-level `Map`. Switching conversations does not lose half-written text.
- **Automatic height:** `height = auto`, then `height = scrollHeight`, capped at 200 pixels.
- **Mobile:** a 16 px font on small screens (iOS zooms the page for fonts under 16 px) and `env(safe-area-inset-bottom)` for iPhones without a home button.
- **Focus:** after choosing "Reply" from the menu, Radix returned focus to the menu button and the composer did not get focus. The fix: `onCloseAutoFocus` with `preventDefault`, and a deferred focus (`setTimeout 0`), because the menu's focus trap is still active in the same commit. The unit test `replies via the message menu and cancels with Escape` found this.

## 6. Portals and the theme

Radix menus and dialogs render in a **portal**, directly under `<body>` and outside the component's DOM tree. So the CSS variables defined on the component's `.rc-root` do not reach them. The fix: `useThemeRoot()` also puts the `rc-root` class, `data-rc-theme` and the tokens on each portal's content.

## 7. Accessibility (a11y)

- Every icon button has an `aria-label` (an `IconButton` cannot be built without a `label`).
- The message list has `role="log"` and `aria-live="polite"`: screen readers announce new messages without interrupting the user.
- The conversation list can be navigated with the ↑/↓ keys.
- `prefers-reduced-motion` turns off all animations.
- Tests are written with `getByRole` and the accessible name (`getByRole('button', { name: 'Reply' })`). If a test cannot find a button by its role and name, a screen reader cannot either. **Testing by role is an accessibility test in itself.**

## 8. Components that do not route

`ConversationList` never calls `navigate`; it takes `onSelect` and `getHref` from the host. The host might use React Router, Next.js or no router at all. With a real `href`, middle-click or Ctrl+click opens a new tab, and a normal click calls `onSelect`. **A library must not make the application's decisions.**

## Exercises

1. In `MessageList.tsx`, change `useLayoutEffect` to `useEffect` and scroll up through the history in the browser. What do you see? Why?
2. With React DevTools (Highlight updates), see which components re-render when another user is typing. Do the `MessageBubble`s re-render too? Why not? (Hint: `memo`.)
3. Write a new hook `useConversationMembers(id)` that returns only the member list and does not re-render when messages change.
