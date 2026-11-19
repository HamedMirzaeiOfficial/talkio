import { ChatSettings, useConnection } from '@realtime-chat/react';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '../components/ui';
import { authApi } from '../lib/auth';
import { notificationsEnabled, notificationsSupported, setNotificationsEnabled } from '../lib/notifications';
import { Page, Section } from './Page';

const shortcuts: [string, string][] = [
  ['Ctrl / ⌘ + K', 'Search messages'],
  ['Alt + N', 'New conversation'],
  ['Alt + ↑ / ↓', 'Previous / next conversation'],
  ['Ctrl / ⌘ + ,', 'Open settings'],
  ['Enter', 'Send (configurable)'],
  ['Shift + Enter', 'New line'],
  ['↑ in empty composer', 'Edit your last message'],
  ['Esc', 'Cancel reply / edit, close panels'],
];

export function Settings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const connection = useConnection();
  const [notify, setNotify] = useState(notificationsEnabled);
  const [signingOut, setSigningOut] = useState(false);

  return (
    <Page title="Settings">
      <Section title="Appearance & messages">
        <ChatSettings />
      </Section>
      <Section
        title="Notifications"
        description="Show a desktop notification for new messages while Talkio is in the background."
      >
        {notificationsSupported() ? (
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm text-fg">Desktop notifications</span>
            <input
              type="checkbox"
              role="switch"
              checked={notify}
              onChange={async (e) => setNotify(await setNotificationsEnabled(e.target.checked))}
              className="size-5 accent-[var(--rc-primary)]"
            />
          </label>
        ) : (
          <p className="text-[13px] text-muted">This browser does not support notifications.</p>
        )}
      </Section>
      <Section title="Keyboard shortcuts">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
          {shortcuts.map(([keys, action]) => (
            <div key={keys} className="contents">
              <dt>
                <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-[12px] text-fg">
                  {keys}
                </kbd>
              </dt>
              <dd className="text-muted">{action}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="Session" description={`Real-time connection: ${connection.status}.`}>
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
          <LogOut className="size-4" /> Sign out
        </Button>
      </Section>
    </Page>
  );
}
