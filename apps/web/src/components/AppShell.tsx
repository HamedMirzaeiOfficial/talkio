import {
  ChatSearch,
  Dialog,
  NewConversationDialog,
  UnreadBadge,
  useConversations,
  UserAvatar,
  useMe,
  useUnreadTotal,
} from '@realtime-chat/react';
import { MessageSquare, Search, Settings as SettingsIcon, SquarePen } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';

import { ThemeSync } from '../app/ThemeSync';
import { Logo } from './ui';
import { t } from '../lib/i18n';

export interface ShellContext {
  openNewConversation: (mode?: 'direct' | 'group') => void;
}

const cx = (...v: (string | false | null | undefined)[]) => v.filter(Boolean).join(' ');

function RailLink({
  to,
  label,
  children,
  end,
}: {
  to: string;
  label: string;
  children: ReactNode;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        cx(
          'relative grid size-10 place-items-center rounded-xl transition',
          isActive ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg',
        )
      }
    >
      {children}
    </NavLink>
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const me = useMe();
  const unread = useUnreadTotal();
  const conversations = useConversations();
  const inConversation = useMatch('/app/c/:conversationId');
  const [searchOpen, setSearchOpen] = useState(false);
  const [creating, setCreating] = useState<'direct' | 'group' | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      } else if (mod && event.key === ',') {
        event.preventDefault();
        navigate('/app/settings');
      } else if (event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setCreating('direct');
      } else if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        if (conversations.length === 0) return;
        event.preventDefault();
        const current = conversations.findIndex((c) => c.id === inConversation?.params.conversationId);
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const next = conversations[(current + delta + conversations.length) % conversations.length];
        if (next) navigate(`/app/c/${next.id}`);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [conversations, inConversation, navigate]);

  const context: ShellContext = { openNewConversation: (mode = 'direct') => setCreating(mode) };

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-bg md:flex-row">
      <ThemeSync />
      {/* Desktop navigation rail */}
      <nav
        aria-label={t('Main')}
        className="hidden w-16 shrink-0 flex-col items-center gap-2 border-e border-border bg-sidebar py-3 md:flex"
      >
        <NavLink to="/app" aria-label={t('Talkio home')} className="mb-2">
          <Logo iconOnly />
        </NavLink>
        <RailLink to="/app" label={t('Chats')}>
          <MessageSquare className="size-5" />
          <UnreadBadge count={unread} className="absolute -end-1 -top-1 ring-2 ring-[var(--rc-sidebar)]" />
        </RailLink>
        <button
          type="button"
          aria-label={t('Search messages (Ctrl+K)')}
          title={t('Search messages (Ctrl+K)')}
          onClick={() => setSearchOpen(true)}
          className="grid size-10 place-items-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <Search className="size-5" />
        </button>
        <button
          type="button"
          aria-label={t('New conversation (Alt+N)')}
          title={t('New conversation (Alt+N)')}
          onClick={() => setCreating('direct')}
          className="grid size-10 place-items-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-fg"
        >
          <SquarePen className="size-5" />
        </button>
        <div className="mt-auto flex flex-col items-center gap-2">
          <RailLink to="/app/settings" label={t('Settings')}>
            <SettingsIcon className="size-5" />
          </RailLink>
          <NavLink
            to="/app/profile"
            aria-label={t('Your profile')}
            title={t('Your profile')}
            className={({ isActive }) =>
              cx(
                'rounded-full ring-offset-2 ring-offset-[var(--rc-sidebar)] transition',
                isActive && 'ring-2 ring-primary',
              )
            }
          >
            <UserAvatar user={me} size="sm" />
          </NavLink>
        </div>
      </nav>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet context={context} />
      </main>

      {/* Mobile tab bar (hidden inside a conversation to give the composer the full width) */}
      {!inConversation && (
        <nav
          aria-label={t('Main')}
          className="flex shrink-0 items-stretch justify-around border-t border-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          {[
            {
              to: '/app',
              label: t('Chats'),
              icon: <MessageSquare className="size-5" />,
              end: true,
              badge: unread,
            },
            { to: '/app/settings', label: t('Settings'), icon: <SettingsIcon className="size-5" /> },
            { to: '/app/profile', label: t('Profile'), icon: <UserAvatar user={me} size="xs" /> },
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cx(
                  'relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
                  isActive ? 'text-primary' : 'text-muted',
                )
              }
            >
              {item.icon}
              {item.label}
              {item.badge ? (
                <UnreadBadge count={item.badge} className="absolute end-[calc(50%-22px)] top-1" />
              ) : null}
            </NavLink>
          ))}
        </nav>
      )}

      <Dialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title={t('Search messages')}
        description={t('Search across all of your conversations.')}
      >
        <ChatSearch
          onSelect={(message) => {
            setSearchOpen(false);
            navigate(`/app/c/${message.conversation_id}`, { state: { from: location.pathname } });
          }}
        />
      </Dialog>
      <NewConversationDialog
        open={creating !== null}
        initialMode={creating ?? 'direct'}
        onOpenChange={(open) => !open && setCreating(null)}
        onCreated={(conversation) => navigate(`/app/c/${conversation.id}`)}
      />
    </div>
  );
}
