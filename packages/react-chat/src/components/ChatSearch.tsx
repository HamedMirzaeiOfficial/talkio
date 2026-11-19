import type { Message } from '@realtime-chat/client';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useChatContext, useThemeRoot } from '../context.js';
import { useChatClient, useChatState } from '../hooks.js';
import { cx, formatListTime } from '../utils.js';
import { EmptyState, Spinner } from './primitives.js';
import { UserAvatar } from './UserAvatar.js';

export interface ChatSearchProps {
  onSelect: (message: Message) => void;
  /** Limit the search to one conversation. */
  conversationId?: string;
  autoFocus?: boolean;
  className?: string;
}

function Highlight({ text, query }: { text: string; query: string }) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0 || !query) return <>{text}</>;
  const start = Math.max(0, index - 40);
  return (
    <>
      {start > 0 && '…'}
      {text.slice(start, index)}
      <mark className="rc:rounded rc:bg-primary-soft rc:px-0.5 rc:text-primary">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

/** Server-side message search across the user's conversations. */
export function ChatSearch({ onSelect, conversationId, autoFocus = true, className }: ChatSearchProps) {
  const client = useChatClient();
  const { strings, locale } = useChatContext();
  const root = useThemeRoot(className);
  const titles = useChatState((s) => s.conversations);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<{ results: Message[]; loading: boolean; error: string | null }>({
    results: [],
    loading: false,
    error: null,
  });
  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) {
      setState({ results: [], loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(() => {
      client.api
        .searchMessages(term, { conversation_id: conversationId, signal: controller.signal })
        .then((page) => setState({ results: page.results, loading: false, error: null }))
        .catch(
          (e: Error & { kind?: string }) =>
            e.kind !== 'aborted' && setState({ results: [], loading: false, error: e.message }),
        );
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, term, conversationId]);

  return (
    <div {...root} className={cx(root.className, 'rc:flex rc:min-h-0 rc:flex-col rc:gap-2')}>
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
          placeholder={strings.searchMessages}
          aria-label={strings.searchMessages}
          className="rc:h-10 rc:w-full rc:rounded-ui rc:border rc:border-border rc:bg-surface rc:ps-9 rc:pe-3 rc:text-sm rc:text-fg rc:focus:border-primary"
        />
      </div>
      <div
        className="rc-scroll rc:min-h-48 rc:flex-1 rc:overflow-y-auto"
        aria-live="polite"
        aria-busy={state.loading}
      >
        {state.loading ? (
          <div className="rc:p-4">
            <Spinner />
          </div>
        ) : state.error ? (
          <p className="rc:p-4 rc:text-[13px] rc:text-danger">{state.error}</p>
        ) : term.length >= 2 && state.results.length === 0 ? (
          <EmptyState title={strings.noResults} />
        ) : (
          <ul className="rc:flex rc:flex-col rc:gap-0.5">
            {state.results.map((message) => (
              <li key={message.id}>
                <button
                  type="button"
                  onClick={() => onSelect(message)}
                  className="rc:flex rc:w-full rc:gap-3 rc:rounded-ui rc:px-2 rc:py-2 rc:text-start rc:hover:bg-surface-2"
                >
                  <UserAvatar user={message.sender} size="sm" />
                  <span className="rc:flex rc:min-w-0 rc:flex-1 rc:flex-col">
                    <span className="rc:flex rc:gap-2 rc:text-[12px] rc:text-muted">
                      <span className="rc:truncate rc:font-medium rc:text-fg">
                        {message.sender?.display_name}
                      </span>
                      {!conversationId && (
                        <span className="rc:truncate">
                          in {titles[message.conversation_id]?.title ?? '…'}
                        </span>
                      )}
                      <span className="rc:ms-auto rc:shrink-0">
                        {formatListTime(message.created_at, locale)}
                      </span>
                    </span>
                    <span dir="auto" className="rc:line-clamp-2 rc:text-[13px] rc:text-fg">
                      <Highlight text={message.body} query={term} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
