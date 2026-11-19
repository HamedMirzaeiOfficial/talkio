export type ClassValue = string | false | null | undefined | 0;

export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}

const RTL_RANGE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;
const LTR_RANGE = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;

/** Direction of the first strong character, like dir="auto" but usable for layout decisions. */
export function textDirection(text: string): 'rtl' | 'ltr' {
  for (const char of text) {
    if (RTL_RANGE.test(char)) return 'rtl';
    if (LTR_RANGE.test(char)) return 'ltr';
  }
  return 'ltr';
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [parts[0]?.[0], parts[0]?.[1]];
  return letters.filter(Boolean).join('').toUpperCase() || '?';
}

/** Muted, theme-friendly avatar tints chosen deterministically from the id. */
const TINTS = ['#6366f1', '#0ea5e9', '#14b8a6', '#8b5cf6', '#f59e0b', '#ec4899', '#64748b'];
export function tintFor(id: string | number): string {
  const text = String(id);
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length]!;
}

export function formatTime(iso: string | null | undefined, locale?: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function isSameDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

export function formatDay(
  iso: string,
  locale?: string,
  now = new Date(),
  labels: { today: string; yesterday: string } = { today: 'Today', yesterday: 'Yesterday' },
): string {
  const date = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(iso, now.toISOString())) return labels.today;
  if (isSameDay(iso, yesterday.toISOString())) return labels.yesterday;
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  }).format(date);
}

/** Compact timestamp for lists: time today, weekday this week, date otherwise. */
export function formatListTime(iso: string | null | undefined, locale?: string, now = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  const diffDays = (now.getTime() - date.getTime()) / 86_400_000;
  if (isSameDay(iso, now.toISOString())) return formatTime(iso, locale);
  if (diffDays < 6) return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
}

export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'a while ago';
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export type TextToken = { type: 'text'; value: string } | { type: 'link'; value: string; href: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi;

/**
 * Split plain text into text and link tokens. Rendering tokens as React nodes (never as
 * HTML) keeps message content inert; only http(s) URLs become links.
 */
export function tokenize(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ type: 'text', value: text.slice(last, index) });
    tokens.push({ type: 'link', value: match[0], href: match[0] });
    last = index + match[0].length;
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });
  return tokens;
}

/** Label for non-text content, e.g. in conversation previews and reply quotes. */
export function kindLabel(
  kind: string | undefined,
  strings: {
    kindPhoto: string;
    kindVideo: string;
    kindGif: string;
    kindVoice: string;
    kindAudio: string;
    kindSticker: string;
    kindFile: string;
  },
): string | null {
  switch (kind) {
    case 'image':
      return `📷 ${strings.kindPhoto}`;
    case 'video':
      return `🎬 ${strings.kindVideo}`;
    case 'gif':
      return strings.kindGif;
    case 'voice':
      return `🎤 ${strings.kindVoice}`;
    case 'audio':
      return `🎵 ${strings.kindAudio}`;
    case 'sticker':
      return strings.kindSticker;
    case 'file':
      return `📎 ${strings.kindFile}`;
    default:
      return null;
  }
}

export function formatDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(seconds ?? 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
