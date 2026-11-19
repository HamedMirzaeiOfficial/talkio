import type { ChatClient } from '@realtime-chat/client';
import { selectUnreadTotal } from '@realtime-chat/client';
import { ChatProvider, useCreateChatClient } from '@realtime-chat/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { FullScreenSpinner } from '../components/FullScreenSpinner';
import { useToast } from '../components/toast';
import { authApi } from '../lib/auth';
import { createAppChatClient } from '../lib/chat';
import { PREFERENCES_KEY } from '../lib/config';
import { notificationsEnabled } from '../lib/notifications';

export function useSession() {
  return useQuery({ queryKey: ['session'], queryFn: authApi.session, staleTime: 60_000, retry: 1 });
}

// Twemoji SVGs served by the app (see vite.config.ts): identical emoji on every OS.
const EMOJI = { baseUrl: `${import.meta.env.BASE_URL}emoji` };

const QUIET = new Set([
  'aborted',
  'not_connected',
  'ack_timeout',
  'connection_lost',
  'disconnected',
  'not_authenticated',
]);

/** Creates the chat client for the signed-in user and provides it to the chat components. */
export function ChatSession({ userId, children }: { userId: number; children: ReactNode }) {
  const queryClient = useQueryClient();
  // A different user always gets a fresh client (and therefore a fresh store).
  const client = useCreateChatClient(
    () => createAppChatClient(() => void queryClient.invalidateQueries({ queryKey: ['session'] })),
    [userId],
  );
  if (!client) return <FullScreenSpinner />;
  return <ChatSessionInner client={client}>{children}</ChatSessionInner>;
}

function ChatSessionInner({ client, children }: { client: ChatClient; children: ReactNode }) {
  const toast = useToast();
  const navigate = useNavigate();

  // Unread count in the tab title.
  useEffect(() => {
    const base = 'Talkio';
    const update = () => {
      const unread = selectUnreadTotal(client.getState());
      document.title = unread ? `(${unread}) ${base}` : base;
    };
    update();
    const unsubscribe = client.subscribe(update);
    return () => {
      unsubscribe();
      document.title = base;
    };
  }, [client]);

  // Desktop notifications for messages that arrive while the tab is hidden.
  useEffect(
    () =>
      client.on('incoming', ({ conversation, message }) => {
        if (!document.hidden || !notificationsEnabled() || Notification.permission !== 'granted') return;
        const notification = new Notification(conversation?.title ?? 'New message', {
          body: message.is_deleted
            ? ''
            : `${message.sender?.display_name ?? ''}: ${message.body || '📎 Attachment'}`,
          tag: message.conversation_id,
        });
        notification.onclick = () => {
          window.focus();
          navigate(`/app/c/${message.conversation_id}`);
        };
      }),
    [client, navigate],
  );

  return (
    <ChatProvider
      client={client}
      storageKey={PREFERENCES_KEY}
      emoji={EMOJI}
      onError={(error) => !QUIET.has(error.code) && toast(error.message, 'error')}
    >
      {children}
    </ChatProvider>
  );
}
