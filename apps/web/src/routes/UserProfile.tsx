import { PresenceIndicator, useChatClient, UserAvatar } from '@realtime-chat/react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { FullScreenSpinner } from '../components/FullScreenSpinner';
import { useToast } from '../components/toast';
import { Button } from '../components/ui';
import { Page } from './Page';

export function UserProfile() {
  const { userId = '' } = useParams();
  const client = useChatClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [starting, setStarting] = useState(false);
  const me = client.getState().me;
  const query = useQuery({
    queryKey: ['user', userId],
    queryFn: ({ signal }) => client.api.getUser(userId, { signal }).then((r) => r.user),
  });

  if (query.isPending) return <FullScreenSpinner />;
  if (query.isError || !query.data) {
    return (
      <Page title="Profile" back>
        <p className="text-sm text-muted">This person is not available.</p>
      </Page>
    );
  }
  const user = query.data;
  const isMe = String(user.id) === String(me?.id);
  return (
    <Page title={user.display_name} back>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface p-8 text-center">
        <UserAvatar user={user} size="xl" showPresence />
        <div>
          <h2 dir="auto" className="text-xl font-semibold text-fg">
            {user.display_name}
          </h2>
          {user.username && <p className="text-sm text-muted">@{user.username}</p>}
        </div>
        <PresenceIndicator userId={user.id} />
        {!isMe && (
          <Button
            className="mt-3"
            loading={starting}
            onClick={async () => {
              setStarting(true);
              try {
                const conversation = await client.startDirect(user.id);
                navigate(`/app/c/${conversation.id}`);
              } catch (e) {
                toast((e as Error).message, 'error');
              } finally {
                setStarting(false);
              }
            }}
          >
            <MessageSquare className="size-4" /> Send message
          </Button>
        )}
      </div>
    </Page>
  );
}
