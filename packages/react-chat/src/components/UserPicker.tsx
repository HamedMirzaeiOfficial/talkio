import type { UserId, UserProfile } from '@realtime-chat/client';
import { Check, Search } from 'lucide-react';
import { useState } from 'react';

import { useChatContext } from '../context.js';
import { useUserSearch } from '../hooks.js';
import { cx } from '../utils.js';
import { EmptyState, Spinner } from './primitives.js';
import { UserAvatar } from './UserAvatar.js';

export interface UserPickerProps {
  /** Single selection calls onPick immediately; multi toggles `selected`. */
  mode: 'single' | 'multi';
  selected?: UserProfile[];
  onPick: (user: UserProfile) => void;
  exclude?: UserId[];
  autoFocus?: boolean;
}

export function UserPicker({ mode, selected = [], onPick, exclude = [], autoFocus = true }: UserPickerProps) {
  const { strings } = useChatContext();
  const [query, setQuery] = useState('');
  const { results, loading, error } = useUserSearch(query);
  const excluded = new Set(exclude.map(String));
  const chosen = new Set(selected.map((u) => String(u.id)));
  const visible = results.filter((u) => !excluded.has(String(u.id)));
  return (
    <div className="rc:flex rc:flex-col rc:gap-2">
      <div className="rc:relative rc:flex rc:items-center">
        <Search
          className="rc:pointer-events-none rc:absolute rc:start-3 rc:size-4 rc:text-subtle"
          aria-hidden
        />
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={strings.searchPeople}
          aria-label={strings.searchPeople}
          className="rc:h-10 rc:w-full rc:rounded-ui rc:border rc:border-border rc:bg-surface rc:ps-9 rc:pe-3 rc:text-sm rc:text-fg rc:focus:border-primary"
        />
      </div>
      {mode === 'multi' && selected.length > 0 && (
        <div className="rc:flex rc:flex-wrap rc:gap-1.5">
          {selected.map((user) => (
            <button
              key={String(user.id)}
              type="button"
              onClick={() => onPick(user)}
              className="rc:inline-flex rc:h-7 rc:items-center rc:gap-1.5 rc:rounded-full rc:bg-primary-soft rc:ps-1 rc:pe-2.5 rc:text-[12px] rc:text-primary"
              aria-label={`Remove ${user.display_name}`}
            >
              <UserAvatar user={user} size="xs" />
              {user.display_name} ×
            </button>
          ))}
        </div>
      )}
      <ul
        role="listbox"
        aria-multiselectable={mode === 'multi'}
        aria-label={strings.searchPeople}
        className="rc:flex rc:min-h-48 rc:flex-col rc:gap-0.5"
      >
        {loading && visible.length === 0 ? (
          <li role="presentation" className="rc:p-4">
            <Spinner />
          </li>
        ) : error ? (
          <li role="presentation" className="rc:p-4 rc:text-[13px] rc:text-danger">
            {error.message}
          </li>
        ) : visible.length === 0 ? (
          <li role="presentation">
            <EmptyState title={query ? strings.noResults : strings.findPeopleHint} />
          </li>
        ) : (
          visible.map((user) => {
            const isSelected = chosen.has(String(user.id));
            return (
              <li key={String(user.id)} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onClick={() => onPick(user)}
                  className={cx(
                    'rc:flex rc:w-full rc:items-center rc:gap-3 rc:rounded-ui rc:px-2 rc:py-2 rc:text-start rc:transition',
                    isSelected ? 'rc:bg-primary-soft' : 'rc:hover:bg-surface-2',
                  )}
                >
                  <UserAvatar user={user} size="sm" showPresence />
                  <span className="rc:flex rc:min-w-0 rc:flex-1 rc:flex-col">
                    <span dir="auto" className="rc:truncate rc:text-sm rc:font-medium rc:text-fg">
                      {user.display_name}
                    </span>
                    {user.username && (
                      <span className="rc:truncate rc:text-[12px] rc:text-muted">@{user.username}</span>
                    )}
                  </span>
                  {mode === 'multi' && (
                    <span
                      className={cx(
                        'rc:grid rc:size-5 rc:place-items-center rc:rounded-full rc:border',
                        isSelected
                          ? 'rc:border-primary rc:bg-primary rc:text-primary-fg'
                          : 'rc:border-border',
                      )}
                    >
                      {isSelected && <Check className="rc:size-3" />}
                    </span>
                  )}
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
