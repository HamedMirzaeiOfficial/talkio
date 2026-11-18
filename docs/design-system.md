# Design System

Pulse uses a compact, dark-first design system inspired by refined developer tools and messaging products without copying a particular brand.

## Tokens

- 8px spacing rhythm, with compact 4px/6px exceptions for dense metadata.
- Charcoal/slate surfaces: page, panel, elevated panel, and interactive surface.
- Indigo/violet is reserved for primary actions, selection, focus rings, and live states.
- Muted text is used for metadata, not essential content.
- Borders are subtle and carry hierarchy when shadows are unnecessary.
- Motion is short and purposeful; reduced-motion preferences disable decorative motion.

## Typography

The current client uses a system UI stack for reliable local rendering. The product can add Inter and Vazirmatn as self-hosted assets later without changing component contracts. English UI copy uses LTR layout; Persian/localized content can be rendered within directional containers.

## Components

- `icon-button`: icon-only actions require an accessible label and tooltip title.
- `avatar`: initials fallback with an optional online indicator.
- `conversation-row`: active, hover, loading, and no-results states share one layout.
- `message-bubble`: plain-text message rendering with sender/time metadata and sender-only actions.
- `composer`: Enter sends, Shift+Enter inserts a newline, and disabled send state reflects empty input.
- `details-panel`: member and shared-file summaries remain secondary to the conversation.

## Accessibility

Controls use semantic buttons and labels, focus-visible rings, status text, readable contrast, and reduced-motion support. Message text is rendered through React text nodes; untrusted content is never inserted as HTML.

## Themes

Dark and light themes use the same semantic tokens. The selected theme is persisted in Zustand/localStorage as a presentation preference only. Authentication and server state are never persisted there.
