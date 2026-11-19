import type { ChatMessage } from '@realtime-chat/client';
import { ArrowDown, MessageCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useChatContext } from '../context.js';
import { useChatClient, useConversation, useMe, useMessages } from '../hooks.js';
import { cx, formatDay, isSameDay } from '../utils.js';
import { MessageBubble } from './MessageBubble.js';
import { Button, EmptyState, Skeleton, Spinner } from './primitives.js';

const GROUP_WINDOW_MS = 5 * 60_000;
const BOTTOM_THRESHOLD = 80;
const LOAD_OLDER_THRESHOLD = 240;

export interface MessageListProps {
  conversationId: string;
  onReply?: (message: ChatMessage) => void;
  onEdit?: (message: ChatMessage) => void;
  onForward?: (message: ChatMessage) => void;
  emptyState?: ReactNode;
  className?: string;
  /** Mark messages as read while the list is visible and scrolled to the bottom. Default true. */
  autoMarkRead?: boolean;
}

export function MessageList({
  conversationId,
  onReply,
  onEdit,
  onForward,
  emptyState,
  className,
  autoMarkRead = true,
}: MessageListProps) {
  const client = useChatClient();
  const { strings, locale, preferences } = useChatContext();
  const me = useMe();
  const conversation = useConversation(conversationId);
  const { items, loaded, loading, hasMoreBefore, error, loadOlder } = useMessages(conversationId);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastHeight = useRef(0);
  const edges = useRef<{ first?: string; last?: string }>({});
  const [showJump, setShowJump] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  // Snapshot of the read marker when the conversation opened, for the "New messages" divider.
  const [unreadFrom, setUnreadFrom] = useState<number | null>(null);

  useEffect(() => {
    atBottom.current = true;
    edges.current = {};
    setShowJump(false);
    setNewCount(0);
    setUnreadFrom(null);
  }, [conversationId]);

  useEffect(() => {
    if (unreadFrom === null && conversation && loaded) {
      setUnreadFrom(
        conversation.unread_count > 0 ? conversation.my_last_read_seq + 1 : Number.POSITIVE_INFINITY,
      );
    }
  }, [conversation, loaded, unreadFrom]);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    atBottom.current = true;
    setShowJump(false);
    setNewCount(0);
  }, []);

  // Keep the viewport stable when older messages are prepended and follow new ones at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const first = items[0]?.id;
    const last = items[items.length - 1]?.id;
    const previous = edges.current;
    const prevHeight = lastHeight.current;
    if (previous.first === undefined && items.length) {
      const divider = el.querySelector<HTMLElement>('[data-unread-divider]');
      if (divider) el.scrollTop = Math.max(0, divider.offsetTop - 80);
      else el.scrollTop = el.scrollHeight;
    } else if (first !== previous.first && last === previous.last) {
      el.scrollTop += el.scrollHeight - prevHeight;
    } else if (last !== previous.last) {
      const newest = items[items.length - 1];
      const mineNewest = newest && newest.sender && String(newest.sender.id) === String(me?.id);
      if (atBottom.current || mineNewest) el.scrollTop = el.scrollHeight;
      else {
        setNewCount((n) => n + 1);
        setShowJump(true);
      }
    }
    edges.current = { first, last };
    lastHeight.current = el.scrollHeight;
  }, [items, me?.id]);

  const markReadIfVisible = useCallback(() => {
    if (!autoMarkRead || !conversation || conversation.unread_count === 0) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (atBottom.current) client.markRead(conversationId);
  }, [autoMarkRead, client, conversation, conversationId]);

  useEffect(() => {
    markReadIfVisible();
    const onVisible = () => markReadIfVisible();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [markReadIfVisible, conversation?.last_seq]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD;
    atBottom.current = bottom;
    setShowJump(!bottom);
    if (bottom) {
      setNewCount(0);
      markReadIfVisible();
    }
    if (el.scrollTop < LOAD_OLDER_THRESHOLD && hasMoreBefore && !loading && loaded) {
      lastHeight.current = el.scrollHeight;
      void loadOlder();
    }
  };

  const jumpTo = useCallback(
    async (messageId: string) => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const node = scroller.current?.querySelector<HTMLElement>(
          `[data-message-id="${CSS.escape(messageId)}"]`,
        );
        if (node) {
          node.scrollIntoView({ block: 'center', behavior: 'smooth' });
          setHighlight(messageId);
          setTimeout(() => setHighlight((h) => (h === messageId ? null : h)), 1600);
          return;
        }
        const list = client.getState().messages[conversationId];
        if (!list?.hasMoreBefore) return;
        await client.loadOlderMessages(conversationId);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    },
    [client, conversationId],
  );

  // Read markers of other members, to compute "read" ticks without O(n·m) per render.
  const readMarkers = useMemo(
    () =>
      (conversation?.members ?? [])
        .filter((m) => String(m.id) !== String(me?.id))
        .map((m) => m.last_read_seq),
    [conversation?.members, me?.id],
  );

  const rows = useMemo(() => {
    let dividerPlaced = false;
    return items.map((message, index) => {
      const prev = items[index - 1];
      const next = items[index + 1];
      const sameSender = (a?: ChatMessage, b?: ChatMessage) =>
        Boolean(
          a &&
          b &&
          a.sender &&
          b.sender &&
          String(a.sender.id) === String(b.sender.id) &&
          !a.is_deleted &&
          !b.is_deleted,
        );
      const newDay = !prev || !isSameDay(prev.created_at, message.created_at);
      const close = (a?: ChatMessage, b?: ChatMessage) =>
        Boolean(a && b && Math.abs(Date.parse(b.created_at) - Date.parse(a.created_at)) < GROUP_WINDOW_MS);
      const mine = message.sender && String(message.sender.id) === String(me?.id);
      let divider = false;
      if (
        !dividerPlaced &&
        unreadFrom !== null &&
        message.status === 'sent' &&
        message.seq >= unreadFrom &&
        !mine
      ) {
        divider = true;
        dividerPlaced = true;
      }
      return {
        message,
        newDay,
        divider,
        groupedWithPrevious: !newDay && !divider && sameSender(prev, message) && close(prev, message),
        groupedWithNext:
          Boolean(next) &&
          isSameDay(message.created_at, next!.created_at) &&
          sameSender(message, next) &&
          close(message, next),
        readCount:
          mine && message.status === 'sent' ? readMarkers.filter((seq) => seq >= message.seq).length : 0,
      };
    });
  }, [items, me?.id, unreadFrom, readMarkers]);

  return (
    <div className={cx('rc:relative rc:flex rc:min-h-0 rc:flex-1 rc:flex-col', className)}>
      <div
        ref={scroller}
        onScroll={onScroll}
        tabIndex={0}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={conversation ? `Messages in ${conversation.title}` : 'Messages'}
        aria-busy={loading}
        className="rc-scroll rc:min-h-0 rc:flex-1 rc:overflow-y-auto rc:pb-3 rc:[overflow-anchor:none] rc:focus-visible:outline-none"
      >
        {!loaded && loading ? (
          <div className="rc:flex rc:flex-col rc:gap-4 rc:p-4" aria-hidden>
            {[40, 64, 28, 52, 36].map((w, i) => (
              <div key={i} className={cx('rc:flex rc:gap-2', i % 2 ? 'rc:justify-end' : 'rc:justify-start')}>
                {i % 2 === 0 && <Skeleton className="rc:size-8 rc:rounded-full" />}
                <span style={{ width: `${w}%` }}>
                  <Skeleton className="rc:h-10 rc:w-full rc:rounded-2xl" />
                </span>
              </div>
            ))}
          </div>
        ) : error && !loaded ? (
          <EmptyState
            title={error.message}
            action={
              <Button size="sm" onClick={() => void client.loadMessages(conversationId)}>
                {strings.retry}
              </Button>
            }
          />
        ) : loaded && items.length === 0 ? (
          (emptyState ?? (
            <EmptyState
              icon={<MessageCircle className="rc:size-5" />}
              title={strings.noMessages}
              hint={strings.noMessagesHint}
            />
          ))
        ) : (
          <>
            <div className="rc:flex rc:h-10 rc:items-center rc:justify-center">
              {loading ? (
                <Spinner label={strings.loadingOlder} />
              ) : (
                !hasMoreBefore && <span className="rc:text-[12px] rc:text-subtle">{strings.beginning}</span>
              )}
            </div>
            {rows.map(({ message, newDay, divider, groupedWithPrevious, groupedWithNext, readCount }) => (
              <Fragment key={message.status === 'sent' ? message.id : `local-${message.client_id}`}>
                {newDay && (
                  <div className="rc:sticky rc:top-2 rc:z-10 rc:my-3 rc:flex rc:justify-center">
                    <span className="rc:rounded-full rc:border rc:border-border rc:bg-surface rc:px-3 rc:py-0.5 rc:text-[12px] rc:font-medium rc:text-muted rc:shadow-sm">
                      {formatDay(message.created_at, locale, new Date(), {
                        today: strings.today,
                        yesterday: strings.yesterday,
                      })}
                    </span>
                  </div>
                )}
                {divider && (
                  <div
                    data-unread-divider
                    className="rc:my-3 rc:flex rc:items-center rc:gap-3 rc:px-4"
                    role="separator"
                  >
                    <span className="rc:h-px rc:flex-1 rc:bg-primary/40" />
                    <span className="rc:text-[12px] rc:font-semibold rc:text-primary">
                      {strings.newMessages}
                    </span>
                    <span className="rc:h-px rc:flex-1 rc:bg-primary/40" />
                  </div>
                )}
                <div className={message.status === 'sent' && !loading ? undefined : 'rc-enter'}>
                  <MessageBubble
                    message={message}
                    groupedWithPrevious={groupedWithPrevious}
                    groupedWithNext={groupedWithNext}
                    readCount={readCount}
                    highlighted={highlight === message.id}
                    compact={preferences.compact}
                    onReply={onReply}
                    onEdit={onEdit}
                    onForward={onForward}
                    onJumpTo={(id) => void jumpTo(id)}
                  />
                </div>
              </Fragment>
            ))}
          </>
        )}
      </div>
      {showJump && loaded && items.length > 0 && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          aria-label={strings.jumpToLatest}
          className="rc-pop rc:absolute rc:end-4 rc:bottom-3 rc:flex rc:h-9 rc:items-center rc:gap-1.5 rc:rounded-full rc:border rc:border-border rc:bg-surface rc:px-3 rc:text-[13px] rc:text-fg rc:shadow-[var(--rc-shadow)] rc:hover:bg-surface-2"
        >
          <ArrowDown className="rc:size-4" />
          {newCount > 0 ? (
            `${newCount} ${strings.newMessages.toLowerCase()}`
          ) : (
            <span className="rc:sr-only">{strings.jumpToLatest}</span>
          )}
        </button>
      )}
    </div>
  );
}
