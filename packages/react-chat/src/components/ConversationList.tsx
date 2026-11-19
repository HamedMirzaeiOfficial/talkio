import type { Conversation } from '@realtime-chat/client';
import { MessageSquarePlus, MessagesSquare, Search, X } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useChatContext, useThemeRoot } from '../context.js';
import { useChatClient, useConversationList, useConversations } from '../hooks.js';
import { cx } from '../utils.js';
import { ConversationItem } from './ConversationItem.js';
import { Button, EmptyState, IconButton, Skeleton } from './primitives.js';

export interface ConversationListProps {
  activeId?: string | null;
  onSelect?: (conversation: Conversation) => void;
  /** Build an href per conversation to integrate with the host router. */
  getHref?: (conversation: Conversation) => string;
  /** Restrict to a kind. */
  kind?: 'direct' | 'group';
  /** Called by the empty-state / header "new" button. Omit to hide the button. */
  onNewConversation?: () => void;
  header?: ReactNode;
  showSearch?: boolean;
  className?: string;
  compact?: boolean;
}

export function ConversationList({
  activeId,
  onSelect,
  getHref,
  kind,
  onNewConversation,
  header,
  showSearch = true,
  className,
  compact = false,
}: ConversationListProps) {
  const client = useChatClient();
  const { strings } = useChatContext();
  const root = useThemeRoot(className);
  const conversations = useConversations();
  const list = useConversationList();
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const sentinel = useRef<HTMLLIElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations.filter(
      (c) =>
        (!kind || c.kind === kind) &&
        (!q ||
          c.title.toLowerCase().includes(q) ||
          c.members.some((m) => m.username?.toLowerCase().includes(q))),
    );
  }, [conversations, query, kind]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !list.hasMore || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting))
        void client.loadConversations({ more: true }).catch(() => undefined);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [client, list.hasMore, visible.length]);

  // Arrow-key navigation between rows (roving focus without extra tab stops).
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-conversation-id]') ?? []);
    const index = items.indexOf(event.currentTarget);
    const next = items[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  return (
    <nav
      {...root}
      aria-label={strings.conversations}
      className={cx(root.className, 'rc:flex rc:h-full rc:min-h-0 rc:flex-col rc:bg-sidebar')}
    >
      {(header || onNewConversation) && (
        <div className="rc:flex rc:items-center rc:justify-between rc:gap-2 rc:px-4 rc:pt-4 rc:pb-2">
          {header ?? <h2 className="rc:text-[15px] rc:font-semibold rc:text-fg">{strings.conversations}</h2>}
          {!header && onNewConversation && (
            <IconButton label={strings.newConversation} onClick={onNewConversation}>
              <MessageSquarePlus className="rc:size-[18px]" />
            </IconButton>
          )}
        </div>
      )}
      {showSearch && (
        <div className="rc:px-3 rc:pb-2">
          <div className="rc:relative rc:flex rc:items-center">
            <Search
              className="rc:pointer-events-none rc:absolute rc:start-2.5 rc:size-4 rc:text-subtle"
              aria-hidden
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuery('');
                if (e.key === 'ArrowDown')
                  listRef.current?.querySelector<HTMLElement>('[data-conversation-id]')?.focus();
              }}
              placeholder={strings.searchConversations}
              aria-label={strings.searchConversations}
              className="rc:h-9 rc:w-full rc:rounded-ui rc:bg-surface-2 rc:ps-8 rc:pe-8 rc:text-[13px] rc:text-fg rc:transition rc:focus:bg-surface rc:focus:ring-1 rc:focus:ring-[var(--rc-ring)] rc:[&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <IconButton
                label={strings.cancel}
                size="sm"
                className="rc:absolute rc:end-1"
                onClick={() => setQuery('')}
              >
                <X className="rc:size-3.5" />
              </IconButton>
            )}
          </div>
        </div>
      )}
      <div className="rc-scroll rc:min-h-0 rc:flex-1 rc:overflow-y-auto rc:px-2 rc:pb-2">
        {!list.loaded && list.loading ? (
          <ul aria-busy="true" className="rc:flex rc:flex-col rc:gap-1 rc:pt-1">
            {Array.from({ length: 7 }, (_, i) => (
              <li key={i} className="rc:flex rc:items-center rc:gap-3 rc:px-2.5 rc:py-2">
                <Skeleton className="rc:size-10 rc:rounded-full" />
                <span className="rc:flex rc:flex-1 rc:flex-col rc:gap-2">
                  <Skeleton className="rc:h-3 rc:w-2/5" />
                  <Skeleton className="rc:h-3 rc:w-4/5" />
                </span>
              </li>
            ))}
          </ul>
        ) : list.error && !list.loaded ? (
          <EmptyState
            title={list.error.message}
            action={
              <Button size="sm" onClick={() => void client.loadConversations().catch(() => undefined)}>
                {strings.retry}
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          query ? (
            <EmptyState title={strings.noMatches} />
          ) : (
            <EmptyState
              icon={<MessagesSquare className="rc:size-5" />}
              title={strings.noConversations}
              hint={strings.noConversationsHint}
              action={
                onNewConversation && (
                  <Button variant="primary" size="sm" onClick={onNewConversation}>
                    {strings.newConversation}
                  </Button>
                )
              }
            />
          )
        ) : (
          <ul ref={listRef} className="rc:flex rc:flex-col rc:gap-0.5">
            {visible.map((conversation) => (
              <li key={conversation.id}>
                <ConversationItem
                  conversation={conversation}
                  active={conversation.id === activeId}
                  onSelect={onSelect}
                  href={getHref?.(conversation)}
                  onKeyDown={onKeyDown}
                  compact={compact}
                />
              </li>
            ))}
            {list.hasMore && !query && <li ref={sentinel} className="rc:h-6" aria-hidden />}
          </ul>
        )}
      </div>
    </nav>
  );
}
