import type { ChatClient } from '@realtime-chat/client';
import { createChatClient } from '@realtime-chat/client';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { act } from 'react';

import { ChatProvider } from '../src';
import { config, conversation, FakeWebSocket, fakeFetch, message } from '../../chat-client/test/fakes';

export { conversation, FakeWebSocket, message };

export function makeClient(routes: Parameters<typeof fakeFetch>[0] = {}) {
  const server = fakeFetch({
    'GET /api/chat/v1/config/': () => config,
    'GET /api/chat/v1/conversations/': () => ({
      results: [
        conversation({ last_seq: 2, unread_count: 1, last_message: message(2) }),
        conversation({ id: 'c2', title: 'Design review', last_activity_at: '2025-12-31T00:00:00Z' }),
      ],
      has_more: false,
      next_cursor: null,
    }),
    'GET /api/chat/v1/conversations/c1/messages/': () => ({
      results: [message(1), message(2)],
      has_more: false,
      next_cursor: null,
    }),
    'GET /api/chat/v1/conversations/c2/messages/': () => ({
      results: [],
      has_more: false,
      next_cursor: null,
    }),
    ...routes,
  });
  const client = createChatClient({
    baseUrl: 'http://localhost/api/chat/v1',
    wsUrl: 'ws://localhost/ws/chat/v1',
    auth: {},
    fetch: server.fetch,
    WebSocket: FakeWebSocket as never,
    ackTimeoutMs: 2000,
  });
  return { client, ...server };
}

export async function renderWithChat(
  ui: ReactNode,
  client: ChatClient,
  props: Partial<Parameters<typeof ChatProvider>[0]> = {},
) {
  const result = render(
    <ChatProvider client={client} storageKey={null} {...props}>
      {ui}
    </ChatProvider>,
  );
  await act(async () => {
    await client.start();
    FakeWebSocket.last.ready();
  });
  return result;
}
