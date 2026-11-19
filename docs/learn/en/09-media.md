# Chapter 9 — Media: emoji, stickers, voice and files

**English** · [فارسی](../09-media.md)

Files for this chapter: `packages/react-chat/src/components/media/*`, `packages/django-chat/src/django_realtime_chat/{files,emoji}.py`, `services/attachments.py`, `apps/web/vite.config.ts`

## 1. Unicode: what is "one character"?

In JavaScript, `"👨‍👩‍👧".length` is **8**. Why?

- JS strings are stored as UTF-16. Emoji above `U+FFFF` take two "code units" each (a **surrogate pair**).
- This emoji is three separate emoji (man, woman, girl) glued together with the invisible **ZWJ** character (`U+200D`, zero-width joiner).

The different levels of "character":

| Level | Example 👋🏽 | Tool |
| --- | --- | --- |
| UTF-16 code unit | 4 | `str.length` |
| Code point | 2 (👋 + skin tone) | `[...str]` |
| **Grapheme cluster** (what the user sees as one character) | 1 | `Intl.Segmenter` |

To detect "this message is only emoji" and to split emoji from text (`splitEmoji`), the project uses `Intl.Segmenter` with `granularity: 'grapheme'`. With `[...str]`, the three-person family would split into five pieces.

Special characters worth knowing:

- `U+FE0F` (variation selector 16): says "show this in color, as emoji"; for example `❤` versus `❤️`.
- `U+1F3FB` to `U+1F3FF`: the five skin tones.
- Flags: two "regional indicators"; 🇮 and 🇷 side by side become 🇮🇷.
- Keycap: `1` + `U+FE0F` + `U+20E3` = 1️⃣.

The server also validates emoji without any external data (`emoji.py::is_emoji`): every code point must be in a pictographic or joining range, and at least one must be pictographic.

## 2. Font versus image: the story of the empty squares

An emoji is really just a character; what it looks like depends on the **system font**. On a system with no color emoji font (a minimal Linux, this server's headless browser), every emoji becomes an empty square (**tofu**). That is exactly what appeared in the screenshots.

A color web font (Noto Color Emoji) was tried first; this browser did not draw it at all, and color fonts come in several formats (COLRv1, CBDT, SVG) with uneven support. So the solution became what Telegram does: **show emoji as images.**

```tsx
<img src={`${baseUrl}/${emojiCodepoints(emoji)}.svg`} alt={emoji} />
```

- The Twemoji set (SVG, CC-BY 4.0 license) is copied into the app's build.
- `alt` is the emoji itself, so copy-paste and screen readers work.
- File naming rule: `FE0F` is dropped unless the sequence contains a ZWJ. ❤️ becomes `2764.svg`, but ❤️‍🔥 becomes `2764-fe0f-200d-1f525.svg`.
- Emoji from newer Unicode versions with no image: `onError` → they are removed from the picker (instead of showing a square).

A remaining limitation: you cannot put images inside a `<textarea>`, so while typing, emoji are shown with the device's font (documented).

### A trap: the order of Vite hooks

The `emojiAssets` plugin in `vite.config.ts` copies the files into `public/emoji/`. The first version used the `buildStart` hook. It worked for `vite build`, but the dev server had listed the contents of `public/` **before** `buildStart`, so the files were not found and an HTML page came back instead of the SVG (`text/html`). Moving to the `config` hook (the earliest of all) fixed it. The lesson: **know your tool's lifecycle**, and test once from a clean state (a deleted folder).

## 3. Emoji data: lazy loading

The list of 1,900 emoji with names and tags is about 540 KB. In the main bundle it would slow down even the sign-in page. So it is loaded with a dynamic `import()` only when the picker opens for the first time (`emojiData.ts::loadEmoji`), and Vite puts it in a separate chunk.

## 4. The picker: UX details

- **Scroll spy:** the category bar shows which section you are in. On `onScroll`, the last section whose top has passed the top of the scroll area becomes active.
- **Skin tone:** right-click (desktop) or a 420 ms hold (touch), with `onPointerDown` and a timer. The choice is saved **per emoji** in `localStorage`. `longPressed` must also be checked, so lifting the finger after a long press does not count as an accidental click.
- **Mobile:** the panel takes the keyboard's place (`textarea.blur()`) and the button turns into a keyboard icon.

## 5. Recording voice in the browser

```
getUserMedia({audio}) → MediaStream
   ├─► MediaRecorder → Blob (audio/webm;codecs=opus, or audio/mp4 in Safari)
   └─► AudioContext → AnalyserNode → RMS every 80ms → live bars + waveform
```

- **Format:** each browser supports different formats; `MediaRecorder.isTypeSupported` picks the first one available.
- **RMS** (root mean square of the samples) = the loudness at that moment.
- `toWaveform` reduces the samples to 64 bars (the maximum of each interval) and normalizes them (loudest = 100). The waveform goes to the server with the file; the receiver does not need to decode the file to see the waveform.
- **Cleanup:** after stopping, the microphone tracks must be `stop()`ped, or the microphone indicator stays on. The `AudioContext` must be closed too.
- **Testing:** Playwright gives Chromium a fake microphone with `--use-fake-device-for-media-stream`; real recording is tested in E2E.

### A server-side bug

WebM and MP4 are used for both audio and video (they are **containers**). The original code identified every WebM as "video", so browser voice notes got a video player. Now the container is identified **reliably** from the bytes, and only after that does the declared type (`audio/...`) choose between the audio and video variant. Trusting client input only within a safe boundary.

## 6. Upload before sending

The file is uploaded first (pending), then its id is sent with the message ([ADR 0006](../../architecture/decisions/0006-upload-then-attach.md)). The benefits:

- A progress bar is shown before the message exists (with `XMLHttpRequest`, because `fetch` has no upload progress).
- The message and its files appear **atomically** (they are attached in one transaction).
- On retry, only the files that were not uploaded are uploaded again.

## 7. Thumbnails

A 4 MB photo shown in a 240-pixel bubble is a waste of bandwidth. On upload, the server creates a WebP with a longest side of at most 480 pixels (respecting EXIF rotation). The client shows that in the list, and the original is downloaded only when the user opens the photo. Animated GIFs get no thumbnail, because the animation would be lost.

## Exercises

1. Run these in the browser console and explain the results: `"🇮🇷".length`, `[..."🇮🇷"].length`, `[...new Intl.Segmenter().segment("🇮🇷")].length`.
2. What does `emojiCodepoints('🏳️‍🌈')` return, and is that file in `node_modules/@twemoji/svg`?
3. Design a "preview a sticker by holding it" feature: which events, which state, and how does it avoid clashing with a normal click?
