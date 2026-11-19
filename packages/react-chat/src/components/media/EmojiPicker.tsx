import {
  Apple,
  Car,
  Clock,
  Flag,
  Hash,
  Lightbulb,
  PawPrint,
  Search,
  Smile,
  Trophy,
  Hand,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useChatContext } from '../../context.js';
import { cx } from '../../utils.js';
import { Spinner } from '../primitives.js';
import { Emoji } from './Emoji.js';
import type { EmojiEntry } from './emojiData.js';
import {
  EMOJI_GROUPS,
  loadEmoji,
  recentEmoji,
  rememberEmoji,
  rememberTone,
  tonePreferences,
} from './emojiData.js';

export { rememberEmoji } from './emojiData.js';

const GROUP_ICONS: Record<number, LucideIcon> = {
  0: Smile,
  1: Hand,
  3: PawPrint,
  4: Apple,
  5: Car,
  6: Trophy,
  7: Lightbulb,
  8: Hash,
  9: Flag,
};
const LONG_PRESS_MS = 420;

interface Section {
  id: string;
  title: string;
  icon: LucideIcon;
  items: EmojiEntry[];
}

export interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  autoFocus?: boolean;
  /** Hide the search box (e.g. tiny reaction pickers). */
  showSearch?: boolean;
  className?: string;
}

/**
 * Grid of native emoji with search, recents, a category bar that follows the scroll
 * position, and skin-tone variants (right-click or long-press, remembered per emoji).
 */
export function EmojiPicker({ onSelect, autoFocus = true, showSearch = true, className }: EmojiPickerProps) {
  const { strings } = useChatContext();
  const [all, setAll] = useState<EmojiEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string>('recent');
  const [tones, setTones] = useState(tonePreferences);
  // Emoji the image set cannot draw are hidden instead of showing a missing-glyph box.
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set());
  const markMissing = useCallback((emoji: string) => setMissing((prev) => new Set(prev).add(emoji)), []);
  const [variants, setVariants] = useState<{ entry: EmojiEntry; x: number; y: number; width: number } | null>(
    null,
  );
  const scroller = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  useEffect(() => {
    let alive = true;
    void loadEmoji().then((list) => alive && setAll(list));
    return () => {
      alive = false;
    };
  }, []);

  const byUnicode = useMemo(() => new Map((all ?? []).map((e) => [e.unicode, e])), [all]);

  const sections = useMemo<Section[]>(() => {
    if (!all) return [];
    const q = query.trim().toLowerCase();
    if (q) {
      const hits = all
        .filter((e) => e.label.includes(q) || e.tags?.some((t) => t.startsWith(q)))
        .slice(0, 180);
      return [{ id: 'search', title: strings.searchEmoji, icon: Search, items: hits }];
    }
    const recents = recentEmoji()
      .map((u) => byUnicode.get(u) ?? { unicode: u, label: u })
      .filter(Boolean);
    const groups = EMOJI_GROUPS.map((g) => ({
      id: String(g.id),
      title: strings[g.label],
      icon: GROUP_ICONS[g.id]!,
      items: all.filter((e) => e.group === g.id),
    }));
    return recents.length
      ? [{ id: 'recent', title: strings.recentEmoji, icon: Clock, items: recents }, ...groups]
      : groups;
  }, [all, query, strings, byUnicode]);

  useEffect(() => {
    if (sections[0]) setActive(sections[0].id);
  }, [sections]);

  // Scroll spy: the category bar highlights the section at the top of the viewport.
  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    let current = sections[0]?.id;
    for (const node of el.querySelectorAll<HTMLElement>('[data-section]')) {
      if (node.offsetTop - el.offsetTop <= el.scrollTop + 12) current = node.dataset.section;
    }
    if (current) setActive(current);
    setVariants(null);
  }, [sections]);

  const jump = (id: string) => {
    const el = scroller.current;
    const node = el?.querySelector<HTMLElement>(`[data-section="${id}"]`);
    if (el && node) el.scrollTo({ top: node.offsetTop - el.offsetTop, behavior: 'smooth' });
    setActive(id);
  };

  const pick = (emoji: string) => {
    rememberEmoji(emoji);
    onSelect(emoji);
  };

  const openVariants = (entry: EmojiEntry, target: HTMLElement) => {
    if (!entry.skins?.length || !scroller.current) return;
    const box = target.getBoundingClientRect();
    const host = scroller.current.parentElement!.getBoundingClientRect();
    setVariants({ entry, x: box.left - host.left + box.width / 2, y: box.top - host.top, width: host.width });
  };

  return (
    <div
      className={cx('rc:relative rc:flex rc:h-full rc:min-h-0 rc:w-full rc:flex-col', className)}
      onKeyDown={(e) => e.key === 'Escape' && variants && (e.stopPropagation(), setVariants(null))}
    >
      {showSearch && (
        <div className="rc:px-3 rc:pt-2 rc:pb-1.5">
          <div className="rc:relative rc:flex rc:items-center">
            <Search
              className="rc:pointer-events-none rc:absolute rc:start-3 rc:size-4 rc:text-subtle"
              aria-hidden
            />
            <input
              type="search"
              autoFocus={autoFocus}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={strings.searchEmoji}
              aria-label={strings.searchEmoji}
              className="rc:h-9 rc:w-full rc:rounded-full rc:bg-surface-2 rc:ps-9 rc:pe-9 rc:text-[13.5px] rc:text-fg rc:transition rc:focus:ring-1 rc:focus:ring-[var(--rc-ring)] rc:[&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                aria-label={strings.cancel}
                onClick={() => setQuery('')}
                className="rc:absolute rc:end-2.5 rc:grid rc:size-5 rc:place-items-center rc:rounded-full rc:bg-subtle/30 rc:text-fg"
              >
                <X className="rc:size-3" />
              </button>
            )}
          </div>
        </div>
      )}
      <div
        ref={scroller}
        onScroll={onScroll}
        className="rc-scroll rc:min-h-0 rc:flex-1 rc:overflow-y-auto rc:px-2 rc:pb-2"
      >
        {!all ? (
          <div className="rc:grid rc:h-full rc:place-items-center">
            <Spinner />
          </div>
        ) : sections.every((s) => s.items.length === 0) ? (
          <div className="rc:flex rc:h-full rc:flex-col rc:items-center rc:justify-center rc:gap-2 rc:text-muted">
            <span className="rc:opacity-60" aria-hidden>
              <Emoji emoji="🔍" size={40} />
            </span>
            <p className="rc:text-[13px]">{strings.noResults}</p>
          </div>
        ) : (
          sections.map((section) => (
            <section key={section.id} data-section={section.id} aria-label={section.title}>
              <h3 className="rc:sticky rc:top-0 rc:z-10 rc:bg-surface/95 rc:px-1.5 rc:pt-2.5 rc:pb-1 rc:text-[12.5px] rc:font-medium rc:text-muted rc:backdrop-blur">
                {section.title}
              </h3>
              <div className="rc:grid rc:grid-cols-[repeat(auto-fill,minmax(40px,1fr))]">
                {section.items.map((entry) => {
                  const shown = tones[entry.unicode] ?? entry.unicode;
                  if (missing.has(shown)) return null;
                  return (
                    <button
                      key={`${section.id}-${entry.unicode}`}
                      type="button"
                      onClick={() => {
                        if (longPressed.current) {
                          longPressed.current = false;
                          return;
                        }
                        pick(shown);
                      }}
                      onContextMenu={(e) => {
                        if (!entry.skins?.length) return;
                        e.preventDefault();
                        openVariants(entry, e.currentTarget);
                      }}
                      onPointerDown={(e) => {
                        if (!entry.skins?.length || e.pointerType === 'mouse') return;
                        const target = e.currentTarget;
                        pressTimer.current = setTimeout(() => {
                          longPressed.current = true;
                          openVariants(entry, target);
                        }, LONG_PRESS_MS);
                      }}
                      onPointerUp={() => pressTimer.current && clearTimeout(pressTimer.current)}
                      onPointerLeave={() => pressTimer.current && clearTimeout(pressTimer.current)}
                      aria-label={entry.label}
                      title={entry.label}
                      className="rc:relative rc:grid rc:aspect-square rc:place-items-center rc:rounded-[10px] rc:leading-none rc:transition-transform rc:duration-100 rc:hover:bg-surface-2 rc:active:scale-90"
                    >
                      <Emoji emoji={shown} size={28} onMissing={markMissing} />
                      {entry.skins?.length ? (
                        // Small corner mark, like native pickers, hinting at skin-tone variants.
                        <span
                          aria-hidden
                          className="rc:absolute rc:end-[5px] rc:bottom-[5px] rc:size-[5px] rc:bg-subtle rc:opacity-50"
                          style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
      {variants && (
        <div
          role="menu"
          aria-label={variants.entry.label}
          className="rc-pop rc:absolute rc:z-20 rc:flex rc:-translate-x-1/2 rc:-translate-y-full rc:gap-0.5 rc:rounded-xl rc:border rc:border-border rc:bg-surface rc:p-1 rc:shadow-[var(--rc-shadow)]"
          // Six 36px buttons ≈ 230px wide: keep the bar inside the panel.
          style={{ left: Math.max(120, Math.min(variants.x, variants.width - 120)), top: variants.y - 4 }}
        >
          {[
            { unicode: variants.entry.unicode, label: variants.entry.label },
            ...(variants.entry.skins ?? []),
          ].map((skin) => (
            <button
              key={skin.unicode}
              type="button"
              role="menuitem"
              aria-label={skin.label}
              onClick={() => {
                rememberTone(variants.entry.unicode, skin.unicode);
                setTones(tonePreferences());
                setVariants(null);
                pick(skin.unicode);
              }}
              className="rc:grid rc:size-9 rc:place-items-center rc:rounded-lg rc:hover:bg-surface-2"
            >
              <Emoji emoji={skin.unicode} size={26} />
            </button>
          ))}
        </div>
      )}
      {!query && all && (
        <nav
          aria-label={strings.emoji}
          className="rc:flex rc:shrink-0 rc:items-center rc:justify-around rc:border-t rc:border-border rc:px-1.5 rc:py-1"
        >
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => jump(section.id)}
                aria-label={section.title}
                aria-current={active === section.id}
                title={section.title}
                className={cx(
                  'rc:grid rc:size-8 rc:place-items-center rc:rounded-full rc:transition',
                  active === section.id
                    ? 'rc:bg-primary-soft rc:text-primary'
                    : 'rc:text-subtle rc:hover:text-fg',
                )}
              >
                <Icon className="rc:size-[18px]" strokeWidth={2} />
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
