import { memo, useState } from 'react';

import { useChatContext } from '../../context.js';
import { EMOJI_FONT } from './emojiData.js';

const ZWJ = '‍';
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\d#*]️?⃣/u;

/** File name used by Twemoji-compatible image sets ("1f44b-1f3fd"). */
export function emojiCodepoints(emoji: string): string {
  const text = emoji.includes(ZWJ) ? emoji : emoji.replace(/️/g, '');
  return [...text].map((ch) => ch.codePointAt(0)!.toString(16)).join('-');
}

export interface EmojiProps {
  emoji: string;
  /** Pixel size; defaults to 1.25em so inline emoji match the surrounding text. */
  size?: number;
  className?: string;
  /** Called when the image set has no file for this emoji (e.g. newer Unicode versions). */
  onMissing?: (emoji: string) => void;
}

/**
 * One emoji. With `<ChatProvider emoji={{ baseUrl }}>` it renders the image set (identical
 * on every OS, independent of installed fonts); otherwise native text. The image's alt
 * text is the emoji itself, so copying and screen readers keep working.
 */
export const Emoji = memo(function Emoji({ emoji, size, className, onMissing }: EmojiProps) {
  const { emojiBaseUrl } = useChatContext();
  const [failed, setFailed] = useState(false);
  const dimension = size ? `${size}px` : '1.25em';
  if (!emojiBaseUrl || failed) {
    return (
      <span
        className={className}
        style={{ fontFamily: EMOJI_FONT, fontSize: size ? size * 0.92 : undefined, lineHeight: 1 }}
      >
        {emoji}
      </span>
    );
  }
  return (
    <img
      src={`${emojiBaseUrl}/${emojiCodepoints(emoji)}.svg`}
      alt={emoji}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(true);
        onMissing?.(emoji);
      }}
      className={className}
      style={{
        width: dimension,
        height: dimension,
        display: 'inline-block',
        verticalAlign: size ? 'middle' : '-0.25em',
      }}
    />
  );
});

type Segment = { emoji: boolean; text: string };

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new (
        Intl as unknown as {
          Segmenter: new (
            l?: string,
            o?: { granularity: string },
          ) => { segment(s: string): Iterable<{ segment: string }> };
        }
      ).Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** Split text into emoji and non-emoji runs (grapheme-aware, keeps ZWJ sequences whole). */
export function splitEmoji(text: string): Segment[] {
  if (!PICTOGRAPHIC.test(text)) return [{ emoji: false, text }];
  const graphemes = segmenter ? [...segmenter.segment(text)].map((s) => s.segment) : [...text];
  const out: Segment[] = [];
  for (const g of graphemes) {
    const isEmoji = PICTOGRAPHIC.test(g) && !/^[\d#*]$/.test(g);
    const last = out[out.length - 1];
    if (!isEmoji && last && !last.emoji) last.text += g;
    else out.push({ emoji: isEmoji, text: g });
  }
  return out;
}

/** Plain text with emoji rendered through <Emoji/>. Never interprets markup. */
export function EmojiText({ text, size }: { text: string; size?: number }) {
  const { emojiBaseUrl } = useChatContext();
  if (!emojiBaseUrl) return <>{text}</>;
  return (
    <>
      {splitEmoji(text).map((part, i) =>
        part.emoji ? <Emoji key={i} emoji={part.text} size={size} /> : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}
