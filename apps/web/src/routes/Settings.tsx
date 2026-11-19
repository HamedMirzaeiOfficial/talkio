import { ChatSettings, useConnection } from '@realtime-chat/react';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button, LangSwitch } from '../components/ui';
import { authApi } from '../lib/auth';
import { notificationsEnabled, notificationsSupported, setNotificationsEnabled } from '../lib/notifications';
import { Page, Section } from './Page';
import { msg, t } from '../lib/i18n';

const shortcuts: [string, string][] = [
  ['Ctrl / ⌘ + K', msg('Search messages')],
  ['Alt + N', msg('New conversation')],
  ['Alt + ↑ / ↓', msg('Previous / next conversation')],
  ['Ctrl / ⌘ + ,', msg('Open settings')],
  ['Enter', msg('Send (configurable)')],
  ['Shift + Enter', msg('New line')],
  [msg('↑ in empty composer'), msg('Edit your last message')],
  ['Esc', msg('Cancel reply / edit, close panels')],
];

const STATUS: Record<string, string> = {
  idle: msg('idle'),
  connecting: msg('connecting'),
  open: msg('connected'),
  reconnecting: msg('reconnecting'),
  offline: msg('offline'),
  unauthenticated: msg('signed out'),
  closed: msg('closed'),
};

export function Settings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const connection = useConnection();
  const [notify, setNotify] = useState(notificationsEnabled);
  const [signingOut, setSigningOut] = useState(false);

  return (
    <Page title={t('Settings')}>
      <Section
        title={t('Language')}
        description={t('Applies to the whole app. Messages keep the direction of their own text.')}
      >
        <LangSwitch />
      </Section>
      <Section title={t('Appearance & messages')}>
        <ChatSettings />
      </Section>
      <Section
        title={t('Notifications')}
        description={t('Show a desktop notification for new messages while Talkio is in the background.')}
      >
        {notificationsSupported() ? (
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm text-fg">{t('Desktop notifications')}</span>
            <input
              type="checkbox"
              role="switch"
              checked={notify}
              onChange={async (e) => setNotify(await setNotificationsEnabled(e.target.checked))}
              className="size-5 accent-[var(--rc-primary)]"
            />
          </label>
        ) : (
          <p className="text-[13px] text-muted">{t('This browser does not support notifications.')}</p>
        )}
      </Section>
      <Section title={t('Keyboard shortcuts')}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
          {shortcuts.map(([keys, action]) => (
            <div key={keys} className="contents">
              <dt>
                <kbd
                  dir="ltr"
                  className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-[12px] text-fg"
                >
                  {t(keys)}
                </kbd>
              </dt>
              <dd className="text-muted">{t(action)}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section
        title={t('Session')}
        description={t('Real-time connection: {status}.', {
          status: t(STATUS[connection.status] ?? connection.status),
        })}
      >
        <Button
          variant="secondary"
          loading={signingOut}
          onClick={async () => {
            setSigningOut(true);
            try {
              await authApi.logout();
            } finally {
              queryClient.clear();
              navigate('/login', { replace: true });
            }
          }}
        >
          <LogOut className="size-4 rtl:-scale-x-100" /> {t('Sign out')}
        </Button>
      </Section>
    </Page>
  );
}
