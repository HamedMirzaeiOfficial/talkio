import type { ChatError } from './errors.js';
import type { ConnectionState } from './socket.js';
import type {
  Attachment,
  ChatConfig,
  ChatUser,
  Conversation,
  Message,
  PresenceInfo,
  ReactionSummary,
  StickerPack,
  UserId,
} from './types.js';

export type DeliveryStatus = 'pending' | 'sent' | 'failed';

export interface LocalAttachment {
  /** Object URL for previews of not-yet-uploaded images. */
  previewUrl: string | null;
  name: string;
  size: number;
  type: string;
  progress: number;
  uploaded: Attachment | null;
  /** Voice note metadata recorded in the browser. */
  voice: { duration: number; waveform: number[] } | null;
}

/** A message as held by the client: server data plus local delivery state. */
export interface ChatMessage extends Message {
  status: DeliveryStatus;
  error: ChatError | null;
  localAttachments: LocalAttachment[];
}

export interface MessageListState {
  items: ChatMessage[];
  loaded: boolean;
  loading: boolean;
  hasMoreBefore: boolean;
  error: ChatError | null;
}

export interface ConversationListState {
  ids: string[];
  loaded: boolean;
  loading: boolean;
  hasMore: boolean;
  cursor: string | null;
  error: ChatError | null;
}

export interface ChatState {
  connection: ConnectionState;
  config: ChatConfig | null;
  me: ChatUser | null;
  conversations: Record<string, Conversation>;
  list: ConversationListState;
  messages: Record<string, MessageListState>;
  /** conversationId → userId → expiry epoch ms */
  typing: Record<string, Record<string, number>>;
  presence: Record<string, PresenceInfo>;
  stickers: { packs: StickerPack[]; loaded: boolean; loading: boolean };
}

export const emptyMessages: MessageListState = Object.freeze({
  items: [],
  loaded: false,
  loading: false,
  hasMoreBefore: true,
  error: null,
}) as MessageListState;

export function initialState(): ChatState {
  return {
    connection: { status: 'idle', attempt: 0, nextRetryAt: null, everConnected: false },
    config: null,
    me: null,
    conversations: {},
    list: { ids: [], loaded: false, loading: false, hasMore: false, cursor: null, error: null },
    messages: {},
    typing: {},
    presence: {},
    stickers: { packs: [], loaded: false, loading: false },
  };
}

type Listener = () => void;

/** Observable state container compatible with React's useSyncExternalStore. */
export class ChatStore {
  private state: ChatState = initialState();
  private listeners = new Set<Listener>();

  getState = (): ChatState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(updater: (state: ChatState) => ChatState): void {
    const next = updater(this.state);
    if (next === this.state) return;
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  reset(): void {
    this.update(() => initialState());
  }
}

/* ---------------------------------------------------------------------------------- */
/* Pure helpers                                                                        */
/* ---------------------------------------------------------------------------------- */

const key = (id: UserId) => String(id);

export function toChatMessage(message: Message, status: DeliveryStatus = 'sent'): ChatMessage {
  return { ...message, status, error: null, localAttachments: [] };
}

function activity(conversation: Conversation): number {
  return Date.parse(conversation.last_activity_at ?? conversation.created_at ?? '') || 0;
}

export function sortIds(conversations: Record<string, Conversation>, ids: string[]): string[] {
  return [...new Set(ids)]
    .filter((id) => conversations[id])
    .sort((a, b) => activity(conversations[b]!) - activity(conversations[a]!) || (a < b ? 1 : -1));
}

function seedPresence(state: ChatState, conversations: Conversation[]): Record<string, PresenceInfo> {
  const presence = { ...state.presence };
  for (const conversation of conversations) {
    for (const member of conversation.members) {
      presence[key(member.id)] = { online: member.online, last_seen_at: member.last_seen_at };
    }
  }
  return presence;
}

export function upsertConversations(
  state: ChatState,
  conversations: Conversation[],
  append = true,
): ChatState {
  if (conversations.length === 0) return state;
  const map = { ...state.conversations };
  for (const conversation of conversations) map[conversation.id] = conversation;
  const ids = append
    ? [...state.list.ids, ...conversations.map((c) => c.id)]
    : conversations.map((c) => c.id);
  return {
    ...state,
    conversations: map,
    presence: seedPresence(state, conversations),
    list: { ...state.list, ids: sortIds(map, ids) },
  };
}

export function removeConversation(state: ChatState, id: string): ChatState {
  if (!state.conversations[id]) return state;
  const conversations = { ...state.conversations };
  delete conversations[id];
  const messages = { ...state.messages };
  delete messages[id];
  return {
    ...state,
    conversations,
    messages,
    list: { ...state.list, ids: state.list.ids.filter((x) => x !== id) },
  };
}

export function patchMessages(
  state: ChatState,
  conversationId: string,
  patch: (list: MessageListState) => MessageListState,
): ChatState {
  const current = state.messages[conversationId] ?? emptyMessages;
  const next = patch(current);
  if (next === current) return state;
  return { ...state, messages: { ...state.messages, [conversationId]: next } };
}

/** Insert/replace server messages, reconciling optimistic ones by client_id. Keeps seq order. */
export function mergeMessages(items: ChatMessage[], incoming: Message[], meId: UserId | null): ChatMessage[] {
  if (incoming.length === 0) return items;
  const byId = new Map<string, ChatMessage>();
  const pending: ChatMessage[] = [];
  for (const item of items) {
    if (item.status === 'sent') byId.set(item.id, item);
    else pending.push(item);
  }
  const confirmed = new Set<string>();
  for (const message of incoming) {
    byId.set(message.id, toChatMessage(message));
    if (meId !== null && message.sender && key(message.sender.id) === key(meId))
      confirmed.add(message.client_id);
  }
  const sent = [...byId.values()].sort((a, b) => a.seq - b.seq);
  const stillPending = pending.filter((item) => !confirmed.has(item.client_id));
  // Pending messages keep their local order after all confirmed ones.
  return [...sent, ...stillPending];
}

export function replaceMessage(items: ChatMessage[], message: Message): ChatMessage[] {
  const index = items.findIndex((item) => item.id === message.id);
  if (index === -1) return items;
  const next = items.slice();
  next[index] = { ...toChatMessage(message), localAttachments: items[index]!.localAttachments };
  return next;
}

export function patchReactions(
  items: ChatMessage[],
  messageId: string,
  reactions: ReactionSummary[],
): ChatMessage[] {
  const index = items.findIndex((item) => item.id === messageId);
  if (index === -1) return items;
  const next = items.slice();
  next[index] = { ...next[index]!, reactions };
  return next;
}

export function patchLocal(
  items: ChatMessage[],
  clientId: string,
  patch: Partial<ChatMessage>,
): ChatMessage[] {
  const index = items.findIndex((item) => item.status !== 'sent' && item.client_id === clientId);
  if (index === -1) return items;
  const next = items.slice();
  next[index] = { ...next[index]!, ...patch };
  return next;
}

export function lastSeq(list: MessageListState | undefined): number {
  if (!list) return 0;
  for (let i = list.items.length - 1; i >= 0; i -= 1) {
    const item = list.items[i]!;
    if (item.status === 'sent') return item.seq;
  }
  return 0;
}

/* ---------------------------------------------------------------------------------- */
/* Selectors                                                                           */
/* ---------------------------------------------------------------------------------- */

export const selectConversationList = (state: ChatState): Conversation[] =>
  state.list.ids.map((id) => state.conversations[id]).filter((c): c is Conversation => Boolean(c));

export const selectUnreadTotal = (state: ChatState): number =>
  Object.values(state.conversations).reduce((sum, c) => sum + (c.unread_count || 0), 0);

export function selectTypingUsers(state: ChatState, conversationId: string, now = Date.now()): ChatUser[] {
  const entries = state.typing[conversationId] ?? {};
  const conversation = state.conversations[conversationId];
  return Object.entries(entries)
    .filter(([, expires]) => expires > now)
    .map(([userId]) => conversation?.members.find((m) => key(m.id) === userId))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
}

export function selectPresence(state: ChatState, userId: UserId | null | undefined): PresenceInfo {
  if (userId === null || userId === undefined) return { online: false, last_seen_at: null };
  return state.presence[key(userId)] ?? { online: false, last_seen_at: null };
}

/** Members (other than the sender) whose read marker has reached this message. */
export function selectReadBy(state: ChatState, message: Pick<Message, 'conversation_id' | 'seq' | 'sender'>) {
  const conversation = state.conversations[message.conversation_id];
  if (!conversation) return [];
  return conversation.members.filter(
    (m) => m.last_read_seq >= message.seq && (!message.sender || key(m.id) !== key(message.sender.id)),
  );
}
