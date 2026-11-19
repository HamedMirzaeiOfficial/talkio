# Design system

**English** · [فارسی](fa/design-system.md)

One token set drives both the React library and the standalone app. Tokens are CSS custom properties defined in `packages/react-chat/src/styles/base.css`; the app maps them into its own Tailwind theme (`apps/web/src/styles.css`), so app chrome and chat components cannot drift apart.

## Tokens

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--rc-bg` | `#0F1117` | `#F9FAFB` | Main canvas, message area |
| `--rc-sidebar` | `#151922` | `#F3F4F6` | Navigation and conversation list |
| `--rc-surface` | `#1D2330` | `#FFFFFF` | Panels, dialogs, composer |
| `--rc-surface-2` | `#252C3B` | `#EEF0F4` | Hover, inputs, chips |
| `--rc-border` | `#2B3342` | `#E3E6EC` | Hairlines |
| `--rc-text` | `#F3F4F6` | `#111827` | Primary text |
| `--rc-muted` | `#9CA3AF` | `#4B5563` | Secondary text (AA on bg/surface) |
| `--rc-subtle` | `#7C8493` | `#6B7280` | Timestamps, placeholders (large/meta text only) |
| `--rc-primary` | `#818CF8` | `#4F46E5` | Accent, focus, active state |
| `--rc-primary-fg` | `#0F1117` | `#FFFFFF` | Text on primary |
| `--rc-primary-soft` | indigo 14 % | indigo 10 % | Selected rows, badges |
| `--rc-bubble-out` / `-fg` | `#4A4FC4` / `#FFFFFF` | `#4F46E5` / `#FFFFFF` | Own messages |
| `--rc-bubble-in` / `-fg` | `#1D2330` / `#F3F4F6` | `#FFFFFF` / `#111827` | Others' messages |
| `--rc-danger` · `--rc-success` · `--rc-warning` | `#F87171` · `#34D399` · `#FBBF24` | `#DC2626` · `#059669` · `#B45309` | Status |
| `--rc-ring` | primary 60 % | primary 55 % | Focus outline |
| `--rc-radius` · `--rc-radius-bubble` | `10px` · `16px` | | Controls · bubbles |
| `--rc-font` · `--rc-font-rtl` | Inter → Vazirmatn → system | | Latin · Persian/Arabic |

Contrast was chosen for WCAG AA on the surfaces where each token is used (body text ≥ 4.5:1: e.g. `#F3F4F6` on `#0F1117`, `#4B5563` on `#FFFFFF`, white on `#4A4FC4`). `--rc-subtle` is reserved for timestamps and placeholders. No automated contrast audit is part of CI.

## Principles

- **Dark-first, quiet surfaces.** Three neutral layers (bg → sidebar → surface) and hairline borders; elevation only for floating UI (menus, dialogs, widget).
- **One accent.** Indigo marks selection, focus, unread and own messages. Status colors appear only for status.
- **Density.** 14 px base, 13 px secondary, 11–12 px meta; 4-px spacing grid; 56 px headers; 40 px avatars in lists, 32 px in messages. A compact preference tightens message spacing.
- **Bubbles.** 16 px radius with a smaller corner on the sender's side for the last message of a run; consecutive messages from one sender within 5 minutes are grouped.
- **Motion.** 140–180 ms ease-out for entering bubbles, menus, dialogs and panel transitions. Everything is disabled under `prefers-reduced-motion` (library CSS) and `MotionConfig reducedMotion="user"` (app).

## Direction and language

- Message bodies, titles, names and inputs use `dir="auto"`, so Persian/Arabic text is right-aligned inside an otherwise LTR layout; `[dir=rtl]` text switches to `--rc-font-rtl`.
- Layout uses logical properties (`ps/pe`, `start/end`, `rounded-es/ee`), so the whole UI mirrors when the host sets `dir="rtl"` on a container.
- Unicode bidi override characters are stripped server-side to prevent visually reordered ("Trojan Source") text.
- The interface itself is available in English and Persian. The app sets `<html lang dir>` before first paint; the components take `strings={faStrings}` and `locale="fa-IR"`, which also switches digits, dates and relative times. Previews keep the author label in the page direction and wrap the message body in `<bdi>`, so mixed-language text never swaps its punctuation.
- Directional icons (back/forward arrows, "open" arrows) mirror with `rtl:-scale-x-100` or `rtl:rotate-180`; technical values (usernames, emails, codes, keyboard shortcuts, code samples) carry `dir="ltr"`.
- The language switch labels each option in its own language ("English", "فارسی") so anyone can find theirs.

## Accessibility

- Every icon-only control has an accessible name; menus and dialogs are Radix primitives (focus trapping, Esc, arrow keys, `aria-*`).
- The message list is a `role="log"` live region; typing changes are announced politely; unread badges have text labels.
- Visible focus rings via `:focus-visible` using `--rc-ring`.
- Keyboard: ↑/↓ through conversations, Enter to send, Shift+Enter newline, ↑ to edit the last message, Esc to cancel reply/edit or close panels; the app adds Ctrl/⌘+K (search), Alt+N (new), Alt+↑/↓ (switch).
- Touch targets ≥ 40 px on mobile; the composer uses 16 px text on small screens to avoid iOS zoom and respects the safe-area inset; the viewport uses `interactive-widget=resizes-content` so the on-screen keyboard shrinks the layout instead of covering the composer.

## Customization

See [integration/react.md](integration/react.md#styling-and-theming). Override any token on `.rc-root` (or via `ChatProvider tokens`). The isolation strategy is described in [ADR 0007](architecture/decisions/0007-style-isolation.md).
