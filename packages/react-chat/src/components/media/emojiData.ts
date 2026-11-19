/** Emoji catalog (lazy), recents and per-emoji skin-tone preferences. */

export interface EmojiEntry {
  unicode: string;
  label: string;
  group?: number;
  order?: number;
  tags?: string[];
  skins?: { unicode: string; label: string }[];
}

export const EMOJI_GROUPS = [
  { id: 0, label: 'emojiGroupSmileys' },
  { id: 1, label: 'emojiGroupPeople' },
  { id: 3, label: 'emojiGroupAnimals' },
  { id: 4, label: 'emojiGroupFood' },
  { id: 5, label: 'emojiGroupTravel' },
  { id: 6, label: 'emojiGroupActivities' },
  { id: 7, label: 'emojiGroupObjects' },
  { id: 8, label: 'emojiGroupSymbols' },
  { id: 9, label: 'emojiGroupFlags' },
] as const;

/** Native color-emoji fonts first, so every platform renders its own full-color set. */
export const EMOJI_FONT =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

let catalog: Promise<EmojiEntry[]> | null = null;

/** ~540 KB of data, fetched on first use only (never part of the initial bundle). */
export function loadEmoji(): Promise<EmojiEntry[]> {
  catalog ??= import('emojibase-data/en/compact.json').then((module) =>
    ((module as { default: EmojiEntry[] }).default ?? (module as unknown as EmojiEntry[]))
      .filter((e) => e.group !== undefined && e.group !== 2)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  );
  return catalog;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) */
  }
}

const RECENT_EMOJI = 'rc:emoji-recents';
const RECENT_STICKERS = 'rc:sticker-recents';
const TONES = 'rc:emoji-tones';

export const recentEmoji = () => read<string[]>(RECENT_EMOJI, []).slice(0, 27);
export const recentStickers = () => read<string[]>(RECENT_STICKERS, []).slice(0, 15);
export const tonePreferences = () => read<Record<string, string>>(TONES, {});

export function rememberEmoji(emoji: string): void {
  write(RECENT_EMOJI, [emoji, ...recentEmoji().filter((e) => e !== emoji)].slice(0, 27));
}

export function rememberSticker(id: string): void {
  write(RECENT_STICKERS, [id, ...recentStickers().filter((s) => s !== id)].slice(0, 15));
}

export function rememberTone(base: string, variant: string): void {
  write(TONES, { ...tonePreferences(), [base]: variant });
}

const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/**
 * Number of emoji when the text consists only of emoji (whitespace allowed), else 0.
 * Used to render short emoji-only messages large, without a bubble.
 */
export function emojiOnlyCount(text: string, max = 3): number {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 64) return 0;
  const Segmenter = (
    Intl as unknown as {
      Segmenter?: new (
        l?: string,
        o?: { granularity: string },
      ) => { segment(s: string): Iterable<{ segment: string }> };
    }
  ).Segmenter;
  const parts = Segmenter
    ? [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)].map((s) => s.segment)
    : [...trimmed];
  const graphemes = parts.filter((p) => p.trim());
  if (graphemes.length === 0 || graphemes.length > max) return 0;
  return graphemes.every((g) => PICTOGRAPHIC.test(g) && !/[\p{L}\p{N}]/u.test(g.replace(/[\d#*]️?⃣/gu, '')))
    ? graphemes.length
    : 0;
}
