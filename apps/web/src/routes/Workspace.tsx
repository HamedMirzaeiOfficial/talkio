import { ChatWindow, ConversationInfoPanel, ConversationList } from '@realtime-chat/react';
import { Plus, Users } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';

import type { ShellContext } from '../components/AppShell';
import { useMediaQuery } from '../lib/useMediaQuery';
import { t } from '../lib/i18n';

const INFO_KEY = 'talkio:info-panel';

export function Workspace() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const shell = useOutletContext<ShellContext>();
  const desktop = useMediaQuery('(min-width: 768px)');
  const wide = useMediaQuery('(min-width: 1180px)');
  const [infoOpen, setInfoOpen] = useState(() => {
    try {
      return localStorage.getItem(INFO_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(INFO_KEY, infoOpen ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [infoOpen]);

  const open = (id: string) => navigate(`/app/c/${id}`);
  const sidebar = (
    <ConversationList
      activeId={conversationId}
      onSelect={(c) => open(c.id)}
      getHref={(c) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/app/c/${c.id}`}
      onNewConversation={() => shell.openNewConversation('direct')}
      header={
        <div className="flex w-full items-center justify-between">
          <h1 className="text-[17px] font-semibold tracking-tight text-fg">{t('Chats')}</h1>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => shell.openNewConversation('group')}
              aria-label={t('New group')}
              title={t('New group')}
              className="grid size-8 place-items-center rounded-ui text-muted transition hover:bg-surface-2 hover:text-fg"
            >
              <Users className="size-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => shell.openNewConversation('direct')}
              aria-label={t('New conversation')}
              title={t('New conversation (Alt+N)')}
              className="grid size-8 place-items-center rounded-ui text-muted transition hover:bg-surface-2 hover:text-fg"
            >
              <Plus className="size-[18px]" />
            </button>
          </div>
        </div>
      }
    />
  );

  const info = conversationId && (
    <ConversationInfoPanel
      conversationId={conversationId}
      onClose={() => setInfoOpen(false)}
      onLeft={() => navigate('/app')}
      onSelectMember={(member) => navigate(`/app/u/${member.id}`)}
    />
  );

  if (!desktop) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
        <AnimatePresence initial={false} mode="popLayout">
          {conversationId ? (
            <motion.div
              key="chat"
              className="flex min-h-0 flex-1 flex-col"
              initial={{ x: '30%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '30%', opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <ChatWindow
                conversationId={conversationId}
                onBack={() => navigate('/app')}
                onToggleInfo={() => setInfoOpen((v) => !v)}
                infoOpen={infoOpen}
                onForwarded={(c) => open(c.id)}
              />
            </motion.div>
          ) : (
            <motion.div
              key="list"
              className="flex min-h-0 flex-1 flex-col"
              initial={{ x: '-10%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '-10%', opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {sidebar}
            </motion.div>
          )}
        </AnimatePresence>
        {conversationId && infoOpen && <div className="absolute inset-0 z-20 flex flex-col">{info}</div>}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[320px] shrink-0 flex-col border-e border-border lg:w-[340px]">{sidebar}</div>
      <div className="flex min-w-0 flex-1 flex-col">
        <ChatWindow
          conversationId={conversationId}
          onToggleInfo={() => setInfoOpen((v) => !v)}
          infoOpen={infoOpen}
          onForwarded={(c) => open(c.id)}
          placeholder={
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div className="flex max-w-sm flex-col items-center gap-3">
                <div className="grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary">
                  <Users className="size-6" />
                </div>
                <h2 className="text-lg font-semibold text-fg">{t('Pick up where you left off')}</h2>
                <p className="text-sm text-muted">
                  {t(
                    'Choose a conversation from the list, or start a new one. Press {keys} to search messages.',
                  )
                    .split('{keys}')
                    .flatMap((part, index) =>
                      index === 0
                        ? [part]
                        : [
                            <kbd
                              key="keys"
                              dir="ltr"
                              className="rounded border border-border px-1.5 py-0.5 text-[12px]"
                            >
                              Ctrl K
                            </kbd>,
                            part,
                          ],
                    )}
                </p>
                <button
                  type="button"
                  onClick={() => shell.openNewConversation('direct')}
                  className="mt-2 h-9 rounded-ui bg-primary px-4 text-sm font-medium text-primary-fg hover:brightness-110"
                >
                  {t('New conversation')}
                </button>
              </div>
            </div>
          }
        />
      </div>
      <AnimatePresence initial={false}>
        {conversationId && infoOpen && (
          <motion.div
            key="info"
            className={
              wide
                ? 'flex w-[320px] shrink-0 flex-col'
                : 'absolute inset-y-0 end-0 z-30 flex w-[340px] flex-col shadow-[var(--rc-shadow)]'
            }
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 24, opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            {info}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
