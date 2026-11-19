import type { Sticker } from '@realtime-chat/client';
import { Clock } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useChatContext } from '../../context.js';
import { useAttachmentUrl, useChatClient, useChatState } from '../../hooks.js';
import { cx } from '../../utils.js';
import { Spinner } from '../primitives.js';
import { Emoji } from './Emoji.js';
import { recentStickers, rememberSticker } from './emojiData.js';

export function StickerImage({
  sticker,
  size = 140,
  className,
}: {
  sticker: Sticker;
  size?: number;
  className?: string;
}) {
  const { url } = useAttachmentUrl({ id: `sticker:${sticker.id}`, url: sticker.url });
  const box = { width: size, height: size };
  return url ? (
    <img
      src={url}
      alt={sticker.emoji || 'Sticker'}
      draggable={false}
      loading="lazy"
      className={className}
      style={{ ...box, objectFit: 'contain' }}
    />
  ) : (
    <span className={cx('rc-skeleton rc:inline-block rc:rounded-2xl', className)} style={box} aria-hidden />
  );
}

/** Sticker sets with a recent section and a pack bar that follows the scroll position. */
export function StickerPicker({ onSelect }: { onSelect: (sticker: Sticker) => void }) {
  const client = useChatClient();
  const { strings } = useChatContext();
  const stickers = useChatState((s) => s.stickers);
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string>('recent');

  useEffect(() => {
    void client.loadStickers().catch(() => undefined);
  }, [client]);

  const sections = useMemo(() => {
    const byId = new Map(stickers.packs.flatMap((p) => p.stickers.map((s) => [s.id, s] as const)));
    const recent = recentStickers()
      .map((id) => byId.get(id))
      .filter((s): s is Sticker => Boolean(s));
    const packs = stickers.packs.map((p) => ({
      id: p.id,
      title: p.name,
      items: p.stickers,
      cover: p.stickers[0],
    }));
    return recent.length
      ? [{ id: 'recent', title: strings.recentEmoji, items: recent, cover: undefined }, ...packs]
      : packs;
  }, [stickers.packs, strings.recentEmoji]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    let current = sections[0]?.id;
    for (const node of el.querySelectorAll<HTMLElement>('[data-section]')) {
      if (node.offsetTop - el.offsetTop <= el.scrollTop + 12) current = node.dataset.section;
    }
    if (current) setActive(current);
  }, [sections]);

  const jump = (id: string) => {
    const el = scroller.current;
    const node = el?.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (el && node) el.scrollTo({ top: node.offsetTop - el.offsetTop, behavior: 'smooth' });
    setActive(id);
  };

  if (!stickers.loaded) {
    return (
      <div className="rc:grid rc:h-full rc:place-items-center">
        <Spinner />
      </div>
    );
  }
  if (sections.length === 0) {
    return (
      <div className="rc:flex rc:h-full rc:flex-col rc:items-center rc:justify-center rc:gap-2 rc:px-6 rc:text-center rc:text-muted">
        <span aria-hidden>
          <Emoji emoji="🗂️" size={44} />
        </span>
        <p className="rc:text-[13px]">{strings.noStickers}</p>
      </div>
    );
  }
  return (
    <div className="rc:flex rc:h-full rc:min-h-0 rc:flex-col">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="rc-scroll rc:min-h-0 rc:flex-1 rc:overflow-y-auto rc:px-2 rc:pb-2"
      >
        {sections.map((section) => (
          <section key={section.id} data-section={section.id} aria-label={section.title}>
            <h3 className="rc:sticky rc:top-0 rc:z-10 rc:bg-surface/95 rc:px-1.5 rc:pt-2.5 rc:pb-1 rc:text-[12.5px] rc:font-medium rc:text-muted rc:backdrop-blur">
              {section.title}
            </h3>
            <div className="rc:grid rc:grid-cols-[repeat(auto-fill,minmax(72px,1fr))] rc:gap-0.5">
              {section.items.map((sticker) => (
                <button
                  key={`${section.id}-${sticker.id}`}
                  type="button"
                  onClick={() => {
                    rememberSticker(sticker.id);
                    onSelect(sticker);
                  }}
                  aria-label={`${strings.kindSticker} ${sticker.emoji}`}
                  title={sticker.emoji}
                  className="rc:group rc:grid rc:aspect-square rc:place-items-center rc:rounded-xl rc:p-1.5 rc:transition rc:hover:bg-surface-2"
                >
                  <StickerImage
                    sticker={sticker}
                    size={64}
                    className="rc:transition-transform rc:duration-150 rc:group-hover:scale-110 rc:group-active:scale-95"
                  />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <nav
        aria-label={strings.stickers}
        className="rc-scroll rc:flex rc:shrink-0 rc:items-center rc:gap-1 rc:overflow-x-auto rc:border-t rc:border-border rc:px-2 rc:py-1"
      >
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => jump(section.id)}
            aria-label={section.title}
            aria-current={active === section.id}
            title={section.title}
            className={cx(
              'rc:grid rc:size-9 rc:shrink-0 rc:place-items-center rc:rounded-xl rc:transition',
              active === section.id
                ? 'rc:bg-primary-soft rc:text-primary'
                : 'rc:text-subtle rc:hover:bg-surface-2',
            )}
          >
            {section.cover ? (
              <StickerImage sticker={section.cover} size={26} />
            ) : (
              <Clock className="rc:size-[18px]" />
            )}
          </button>
        ))}
      </nav>
    </div>
  );
}
