export { createChatClient, createClientId } from './client.js';
export type { ChatClient, ChatClientOptions, SendMessageOptions } from './client.js';
export { ChatApi } from './api.js';
export type { HistoryQuery, SendMessageInput } from './api.js';
export { bearerAuth, sessionAuth } from './auth.js';
export type { AuthAdapter, BearerAuthOptions, SessionAuthOptions } from './auth.js';
export { ChatError, isChatError } from './errors.js';
export type { ChatErrorKind } from './errors.js';
export { HttpClient } from './http.js';
export { ChatSocket, toWebSocketUrl } from './socket.js';
export type { ConnectionState, ConnectionStatus, ReconnectOptions, SocketOptions } from './socket.js';
export {
  ChatStore,
  emptyMessages,
  selectConversationList,
  selectPresence,
  selectReadBy,
  selectTypingUsers,
  selectUnreadTotal,
} from './store.js';
export type {
  ChatMessage,
  ChatState,
  ConversationListState,
  DeliveryStatus,
  LocalAttachment,
  MessageListState,
} from './store.js';
export * from './types.js';
