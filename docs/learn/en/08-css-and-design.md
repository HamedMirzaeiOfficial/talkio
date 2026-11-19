# Chapter 8 — CSS, design and style isolation

**English** · [فارسی](../08-css-and-design.md)

Files for this chapter: `packages/react-chat/src/styles/{index,base}.css`, `apps/web/src/styles.css`, `packages/react-chat/test/styles.test.tsx`, [design-system.md](../../design-system.md), [ADR 0007](../../architecture/decisions/0007-style-isolation.md)

## 1. The problem: a component that lives in someone else's house

The chat widget renders inside the host's site. There are two dangers:

1. **The host's CSS breaks the widget.** For example `button { border-radius: 0 }` or `* { font-family: Georgia }`.
2. **The widget's CSS breaks the host's site.** For example a global reset like `* { margin: 0 }` in the library's CSS.

Common solutions, and why they were not chosen:

- **Shadow DOM:** full isolation, but it breaks Radix portals, fonts and the host's theme.
- **iframe:** very heavy, and communicating with the host app is hard.

Chosen: **a prefix + variables + a scoped reset + precise control of the cascade.**

## 2. Specificity: which rule wins?

When two CSS rules set the same property, these are checked in order:

1. **Cascade layer** (`@layer`): rules outside any layer beat rules inside a layer.
2. **Specificity:** `(id, class, element)`; `#a` = (1,0,0), `.a` = (0,1,0), `button` = (0,0,1), `*` = (0,0,0).
3. **Source order:** with equal specificity, the later rule wins.

`:where(...)` has zero specificity. So `.rc-root :where(*)` = (0,1,0).

## 3. Designing the reset

```css
.rc-root, .rc-root :where(*) {          /* (0,1,0) */
  margin: 0; padding: 0; box-sizing: border-box;
  font-family: inherit; line-height: inherit; ...
}
```

- Against the host's `button { ... }` (0,0,1): the reset wins. ✓
- Against the library's own `.rc\:px-3 { padding-inline: ... }` (0,1,0): they are equal, so **order** decides. The reset must come **before** the utilities.

### The bug: the reset after the utilities

The first version looked like this:

```css
@import 'tailwindcss/utilities.css' prefix(rc);
/* … */
.rc-root :where(*) { padding: 0; }   /* after the utilities! */
```

`@import`s always go at the top of the file. So the reset came after all the utilities and **every padding became zero**. It was completely obvious in the screenshots (everything was squashed together), while no unit test caught it, because jsdom has no layout. The fix: the reset moved to a separate `base.css` file, imported **before** the utilities. A test also checks the order in the final CSS.

### The bug: font inheritance

The host site's `* { font-family: Georgia }` rule has zero specificity but applies **directly** to every element. An important CSS rule: **any explicit rule, even with zero specificity, beats inheritance.** Inheritance only works when no rule sets that property. So the text inside the widget became Georgia. The fix: the reset itself sets `font-family: inherit` with specificity (0,1,0), re-establishing inheritance from `.rc-root`. The E2E test `widget-example.spec.ts` checks the font of an **inner** element. The test's first version only checked the root, which is why it missed this bug.

## 4. Cascade layers and unlayered utilities

Tailwind v4 puts utilities in `@layer utilities` by default. If the host site has unlayered CSS such as `button { background: red }`, that rule beats **every** layered rule, even `.rc\:bg-primary`. That is why the library's utilities are imported without a layer:

```css
@import 'tailwindcss/utilities.css' prefix(rc);   /* no layer() */
```

## 5. The prefix

With `prefix(rc)`, the classes are `rc:flex` and `rc:bg-surface`. Even if the host uses Tailwind itself, the two sides' classes never collide.

## 6. Design tokens with CSS custom properties

```css
.rc-root { --rc-bg: #f9fafb; --rc-primary: #4f46e5; ... }
.rc-root[data-rc-theme='dark'] { --rc-bg: #0f1117; --rc-primary: #818cf8; ... }
```

and in Tailwind:

```css
@theme inline { --color-surface: var(--rc-surface); }
```

The benefits:

- Changing the theme = changing one attribute. No class in any component changes.
- The host passes its brand color as a prop (`tokens={{ primary: '#0f766e' }}`) and `useThemeRoot` puts it on the root as an inline `style`.
- The Talkio app uses the same tokens in its own Tailwind, so the app's chrome and the chat components never get different colors.

`.rc-tokens` is a class for a page that wants only the variables and not the reset. The app's `<html>` has this class. The first version had `rc-root` on `<html>`, so the library's reset applied to the whole app; that was one of the causes of the padding bug.

## 7. Preventing a theme flash

If the theme is applied after React loads, the page is white for a moment and then turns dark. `apps/web/index.html` has a small script **before** the bundle that reads the saved setting from `localStorage` and puts `data-rc-theme` on `<html>` immediately.

## 8. RTL and bidirectional text

- **Logical properties:** `padding-inline-start` (`rc:ps-3`) is used instead of `padding-left`. When the host sets `dir="rtl"`, the whole UI mirrors automatically.
- **`dir="auto"` on user text:** the browser picks the direction from the first "strong" character. A Persian message is right-aligned and an English one left-aligned, inside a single UI.
- Directional icons (the "back" arrow, the send icon) are flipped in RTL (`rc:rtl:rotate-180`).

Chapter 13 covers translating the UI itself into Persian.

## 9. A strange bug: `.gitignore` and Tailwind

Tailwind v4 does not scan **gitignored** files for classes. The old `.gitignore` had a `media` line (for Django uploads), which also matched the `components/media/` folder (the emoji picker). Two problems resulted: those components' classes were not generated in the CSS (the panel became 26,000 pixels tall!), and **git also ignored those files**, so they were missing from commits. The lesson: **anchor** `.gitignore` patterns (`/apps/server/media/`, not `media`).

## Exercises

1. In DevTools, on one of the widget's buttons in `examples/react-integration`, open the Computed panel and see which rule won `border-radius` and why.
2. Temporarily move `@import './base.css'` after the utilities line and run `npm run build` and the `styles.test.tsx` test.
3. Build a new "sepia" theme by redefining a few tokens on `.rc-root[data-rc-theme='sepia']`. What else is needed so it can be chosen in `ChatSettings`?
