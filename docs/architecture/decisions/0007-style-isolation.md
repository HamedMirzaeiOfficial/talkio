# ADR 0007: Style isolation without Shadow DOM

## Status

Accepted (2026-11-19)

## Context

The React components must look the same inside any host and must not change the host's look. Shadow DOM would break Radix portals, host theming and form integration.

## Decision

- Tailwind utilities are compiled with the `rc:` prefix and emitted **unlayered**.
- Design tokens are CSS variables (`--rc-*`) set on `.rc-root` (every component root and portal content) and optionally `.rc-tokens` (host pages that want only the variables).
- No global preflight. A minimal reset scoped to `.rc-root :where(*)` (specificity 0,1,0) is emitted **before** utilities: it beats host element selectors and `*` rules but loses to utilities. It also re-establishes inheritance of font, size, line-height, letter-spacing and text-transform, because host rules like `* { font-family }` match elements directly and would otherwise beat inheritance.
- A built-CSS test asserts the ordering and that no rule targets bare host elements; an E2E test embeds the widget in a host with aggressive global CSS and checks computed styles in both directions.

## Consequences

Hosts with ID-qualified selectors (e.g. `#app button {}`) can still win; this is documented. Fonts are not bundled by the library: hosts load Inter/Vazirmatn or override `--rc-font`.
