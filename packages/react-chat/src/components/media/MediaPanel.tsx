import type { Sticker } from '@realtime-chat/client';
import { useState } from 'react';

import { useChatContext } from '../../context.js';
import { cx } from '../../utils.js';
import { EmojiPicker } from './EmojiPicker.js';
import { StickerPicker } from './StickerPicker.js';

export type MediaTab = 'emoji' | 'stickers';

export interface MediaPanelProps {
  onEmoji: (emoji: string) => void;
  onSticker?: (sticker: Sticker) => void;
  /** Initial/remembered tab. */
  defaultTab?: MediaTab;
  onTabChange?: (tab: MediaTab) => void;
  /** 'popover' on desktop; 'sheet' docks under the composer on phones (replaces the keyboard). */
  variant?: 'popover' | 'sheet';
  className?: string;
}

/** Emoji and sticker panel used by the composer. */
export function MediaPanel({
  onEmoji,
  onSticker,
  defaultTab = 'emoji',
  onTabChange,
  variant = 'popover',
  className,
}: MediaPanelProps) {
  const { strings } = useChatContext();
  const [tab, setTab] = useState<MediaTab>(onSticker ? defaultTab : 'emoji');
  const select = (next: MediaTab) => {
    setTab(next);
    onTabChange?.(next);
  };
  return (
    <div
      className={cx(
        'rc:flex rc:flex-col rc:bg-surface',
        variant === 'popover'
          ? 'rc:h-[420px] rc:w-[min(376px,calc(100vw-16px))]'
          : 'rc:h-[min(320px,45dvh)] rc:w-full',
        className,
      )}
    >
      {onSticker && (
        <div
          role="tablist"
          aria-label={strings.emoji}
          className="rc:flex rc:shrink-0 rc:justify-center rc:gap-1 rc:px-3 rc:pt-2.5"
        >
          {(['emoji', 'stickers'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => select(value)}
              className={cx(
                'rc:h-7 rc:rounded-full rc:px-3.5 rc:text-[13px] rc:font-medium rc:transition',
                tab === value ? 'rc:bg-primary-soft rc:text-primary' : 'rc:text-muted rc:hover:text-fg',
              )}
            >
              {value === 'emoji' ? strings.emoji : strings.stickers}
            </button>
          ))}
        </div>
      )}
      <div className="rc:min-h-0 rc:flex-1">
        {tab === 'stickers' && onSticker ? (
          <StickerPicker onSelect={onSticker} />
        ) : (
          <EmojiPicker onSelect={onEmoji} autoFocus={variant === 'popover'} />
        )}
      </div>
    </div>
  );
}
