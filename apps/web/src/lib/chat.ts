import type { ChatClient } from '@realtime-chat/client';
import { createChatClient, sessionAuth } from '@realtime-chat/client';

import { urls } from './config';

/** One client per signed-in session. Disposed on sign-out so no state leaks between users. */
export function createAppChatClient(onUnauthorized: () => void): ChatClient {
  return createChatClient({
    baseUrl: urls.chat,
    wsUrl: urls.ws,
    auth: sessionAuth({ csrfUrl: `${urls.auth}/session/`, onUnauthorized }),
  });
}
