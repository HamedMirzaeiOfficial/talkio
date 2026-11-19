import { ChatApi } from './api.js';
import type { AuthAdapter } from './auth.js';
import { sessionAuth } from './auth.js';
import { Emitter } from './emitter.js';
import { ChatError } from './errors.js';
import { HttpClient } from './http.js';
import type { ConnectionState, ReconnectOptions } from './socket.js';
import { ChatSocket } from './socket.js';
import type { ChatMessage, ChatState, LocalAttachment } from './store.js';
import {
  ChatStore,
  emptyMessages,
  lastSeq,
  mergeMessages,
  patchLocal,
  patchMessages,
  patchReactions,
  removeConversation,
  replaceMessage,
  selectUnreadTotal,
  sortIds,
  upsertConversations,
} from './store.js';
import type { Attachment, Conversation, MemberRole, Message, ServerEvent, Sticker, UserId } from './types.js';

export interface ChatClientOptions {
  /** REST base, e.g. "/api/chat/v1" or "https://chat.example.com/api/chat/v1". */
  baseUrl: string;
  /** WebSocket base, e.g. "/ws/chat/v1" or "wss://chat.example.com/ws/chat/v1". */
  wsUrl: string;
  /** Defaults to Django session auth with CSRF. */
  auth?: AuthAdapter;
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket;
  reconnect?: ReconnectOptions;
  /** How long to wait for a WebSocket ack before retrying a send over HTTP. */
  ackTimeoutMs?: number;
  pageSize?: number;
  /**
   * Current UI language (e.g. `() => 'fa'`), sent as Accept-Language on REST requests so error messages
   * from the server match the interface. Defaults to the browser's own Accept-Language.
   */
  language?: () => string | undefined;
}

export interface SendMessageOptions {
  body?: string;
  replyToId?: string | null;
  files?: File[];
  /** A recorded voice note (sent as the message's only attachment). */
  voice?: { file: File; duration: number; waveform: number[] };
  /** Send a sticker on its own (no body/files). */
  sticker?: Sticker;
}

type ClientEvents = {
  event: ServerEvent;
  connection: ConnectionState;
  error: ChatError;
  /** A message from someone else arrived (useful for notifications/sounds). */
  incoming: { conversation: Conversation | undefined; message: Message };
};

export interface ChatClient {
  readonly store: ChatStore;
  readonly api: ChatApi;
  readonly socket: ChatSocket;
  getState(): ChatState;
  subscribe(listener: () => void): () => void;
  on<K extends keyof ClientEvents>(event: K, listener: (payload: ClientEvents[K]) => void): () => void;
  /** Load config + first page of conversations and open the socket. Idempotent. */
  start(): Promise<void>;
  connect(): void;
  disconnect(): void;
  /** Close everything; the instance cannot be used afterwards. */
  dispose(): void;
  loadConversations(options?: { more?: boolean; signal?: AbortSignal }): Promise<void>;
  refreshConversation(id: string): Promise<Conversation | null>;
  loadMessages(conversationId: string, options?: { signal?: AbortSignal }): Promise<void>;
  loadOlderMessages(conversationId: string): Promise<void>;
  sendMessage(conversationId: string, options: SendMessageOptions): Promise<ChatMessage>;
  retryMessage(conversationId: string, clientId: string): Promise<ChatMessage | null>;
  discardMessage(conversationId: string, clientId: string): void;
  editMessage(messageId: string, body: string): Promise<Message>;
  deleteMessage(messageId: string): Promise<Message>;
  toggleReaction(messageId: string, emoji: string): Promise<void>;
  togglePin(messageId: string): Promise<Message>;
  forwardMessage(messageId: string, conversationId: string): Promise<Message>;
  /** Load sticker packs once (cached in state.stickers). */
  loadStickers(): Promise<void>;
  markRead(conversationId: string): void;
  setTyping(conversationId: string, typing: boolean): void;
  startDirect(userId: UserId): Promise<Conversation>;
  createGroup(input: { title: string; memberIds: UserId[]; description?: string }): Promise<Conversation>;
  updateConversation(id: string, patch: { title?: string; description?: string }): Promise<Conversation>;
  addMembers(id: string, userIds: UserId[]): Promise<Conversation>;
  removeMember(id: string, userId: UserId): Promise<void>;
  leaveConversation(id: string): Promise<void>;
  changeRole(id: string, userId: UserId, role: MemberRole): Promise<Conversation>;
  /** URL usable in <img>/<a>. With cookie auth the URL is returned as-is; otherwise a blob URL. */
  resolveAttachmentUrl(
    attachment: Pick<Attachment, 'id' | 'url'>,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
  unreadTotal(): number;
}

const TYPING_RESEND_MS = 3_000;
const READ_DEBOUNCE_MS = 250;

export function createClientId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function createChatClient(options: ChatClientOptions): ChatClient {
  const auth = options.auth ?? sessionAuth();
  const http = new HttpClient({
    baseUrl: options.baseUrl,
    auth,
    fetch: options.fetch,
    language: options.language,
  });
  const api = new ChatApi(http);
  const store = new ChatStore();
  const emitter = new Emitter<ClientEvents>();
  const pageSize = options.pageSize ?? 50;
  const ackTimeoutMs = options.ackTimeoutMs ?? 8_000;
  const wsBase = options.wsUrl.replace(/\/+$/, '') + '/';

  const socket = new ChatSocket({
    url: wsBase,
    WebSocket: options.WebSocket,
    reconnect: options.reconnect,
    requestTimeoutMs: ackTimeoutMs,
    // Resolved on every (re)connect: a fresh ticket if the auth needs one, and the current UI language
    // (`?lang=`) so error messages sent over the socket match the interface.
    resolveUrl:
      auth.useSocketTicket || options.language
        ? async (url) => {
            const params: string[] = [];
            const language = options.language?.();
            if (language) params.push(`lang=${encodeURIComponent(language)}`);
            if (auth.useSocketTicket) {
              const { ticket } = await api.socketTicket();
              params.push(`ticket=${encodeURIComponent(ticket)}`);
            }
            return params.length ? `${url}${url.includes('?') ? '&' : '?'}${params.join('&')}` : url;
          }
        : undefined,
  });

  let disposed = false;
  let started: Promise<void> | null = null;
  let lastSyncAt: string | null = null;
  const files = new Map<string, File[]>(); // clientId → original files (for retry)
  const typingSentAt = new Map<string, number>();
  const readTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const blobUrls = new Map<string, string>();
  const gapFetches = new Set<string>();
  let typingSweep: ReturnType<typeof setInterval> | null = null;

  const update = (fn: (s: ChatState) => ChatState) => {
    if (!disposed) store.update(fn);
  };
  const meId = () => store.getState().me?.id ?? null;
  const isMe = (id: UserId | null | undefined) =>
    id !== null && id !== undefined && String(id) === String(meId());
  const report = (error: unknown) => {
    const chatError = ChatError.from(error);
    if (chatError.kind !== 'aborted') emitter.emit('error', chatError);
    return chatError;
  };

  socket.on('status', (connection) => {
    update((s) => ({ ...s, connection }));
    emitter.emit('connection', connection);
    if (connection.status === 'unauthenticated') auth.onUnauthorized?.();
  });
  socket.on('ready', (ready) => {
    update((s) => ({ ...s, me: s.me ?? ready.user }));
    if (ready.recovered) void recover(ready.server_time);
    else lastSyncAt = ready.server_time;
    void flushPending();
  });
  socket.on('event', (event) => {
    handleEvent(event);
    emitter.emit('event', event);
  });

  /* ------------------------------ event handling ------------------------------ */

  function handleEvent(event: ServerEvent): void {
    switch (event.type) {
      case 'message.created':
        return onMessageCreated(event.message);
      case 'message.updated':
      case 'message.deleted':
        update((s) => {
          let next = patchMessages(s, event.conversation_id, (list) => {
            const items = replaceMessage(list.items, event.message);
            return items === list.items ? list : { ...list, items };
          });
          const conversation = next.conversations[event.conversation_id];
          if (conversation?.last_message?.id === event.message.id) {
            next = {
              ...next,
              conversations: {
                ...next.conversations,
                [conversation.id]: { ...conversation, last_message: event.message },
              },
            };
          }
          return next;
        });
        return;
      case 'reaction.updated':
        update((s) =>
          patchMessages(s, event.conversation_id, (list) => {
            const items = patchReactions(list.items, event.message_id, event.reactions);
            return items === list.items ? list : { ...list, items };
          }),
        );
        return;
      case 'typing.updated':
        update((s) => {
          const current = { ...(s.typing[event.conversation_id] ?? {}) };
          if (event.is_typing) current[String(event.user_id)] = Date.now() + event.expires_in * 1000;
          else delete current[String(event.user_id)];
          return { ...s, typing: { ...s.typing, [event.conversation_id]: current } };
        });
        ensureTypingSweep();
        return;
      case 'presence.updated':
        update((s) => ({
          ...s,
          presence: {
            ...s.presence,
            [String(event.user_id)]: { online: event.online, last_seen_at: event.last_seen_at },
          },
        }));
        return;
      case 'read.updated':
        update((s) => {
          const conversation = s.conversations[event.conversation_id];
          if (!conversation) return s;
          const members = conversation.members.map((m) =>
            String(m.id) === String(event.user_id)
              ? { ...m, last_read_seq: Math.max(m.last_read_seq, event.last_read_seq) }
              : m,
          );
          const mine = isMe(event.user_id);
          const myRead = mine
            ? Math.max(conversation.my_last_read_seq, event.last_read_seq)
            : conversation.my_last_read_seq;
          const unread = mine && myRead >= conversation.last_seq ? 0 : conversation.unread_count;
          return {
            ...s,
            conversations: {
              ...s.conversations,
              [conversation.id]: { ...conversation, members, my_last_read_seq: myRead, unread_count: unread },
            },
          };
        });
        return;
      case 'conversation.updated':
        update((s) => upsertConversations(s, [event.conversation]));
        return;
      case 'conversation.removed':
        update((s) => removeConversation(s, event.conversation_id));
        return;
      default:
        return;
    }
  }

  function onMessageCreated(message: Message): void {
    const state = store.getState();
    const conversation = state.conversations[message.conversation_id];
    const list = state.messages[message.conversation_id];
    const knownSeq = lastSeq(list);
    const mine = isMe(message.sender?.id);
    update((s) => {
      let next = patchMessages(s, message.conversation_id, (current) =>
        current.loaded ? { ...current, items: mergeMessages(current.items, [message], meId()) } : current,
      );
      const conv = next.conversations[message.conversation_id];
      if (conv) {
        const isNew = message.seq > conv.last_seq;
        const updated: Conversation = {
          ...conv,
          last_seq: Math.max(conv.last_seq, message.seq),
          last_message: isNew ? message : conv.last_message,
          last_activity_at: isNew ? message.created_at : conv.last_activity_at,
          my_last_read_seq: mine ? Math.max(conv.my_last_read_seq, message.seq) : conv.my_last_read_seq,
          unread_count:
            !mine && isNew && message.seq > conv.my_last_read_seq
              ? conv.unread_count + 1
              : mine
                ? 0
                : conv.unread_count,
        };
        const conversations = { ...next.conversations, [conv.id]: updated };
        next = { ...next, conversations, list: { ...next.list, ids: sortIds(conversations, next.list.ids) } };
      }
      return next;
    });
    if (!conversation) void refreshConversation(message.conversation_id);
    if (list?.loaded && knownSeq > 0 && message.seq > knownSeq + 1)
      void fetchGap(message.conversation_id, knownSeq);
    if (!mine)
      emitter.emit('incoming', {
        conversation: store.getState().conversations[message.conversation_id],
        message,
      });
  }

  async function fetchGap(conversationId: string, after: number): Promise<void> {
    if (gapFetches.has(conversationId)) return;
    gapFetches.add(conversationId);
    try {
      let cursor = after;
      for (let page = 0; page < 5; page += 1) {
        const result = await api.listMessages(conversationId, { after: cursor, limit: 100 });
        update((s) =>
          patchMessages(s, conversationId, (list) => ({
            ...list,
            items: mergeMessages(list.items, result.results, meId()),
          })),
        );
        if (!result.has_more || !result.next_cursor) return;
        cursor = Number(result.next_cursor);
      }
      // Too far behind: drop the local window and reload the latest page.
      update((s) => patchMessages(s, conversationId, () => emptyMessages));
      await loadMessages(conversationId);
    } catch (error) {
      report(error);
    } finally {
      gapFetches.delete(conversationId);
    }
  }

  /** After a reconnect: refresh the list, fill message gaps and pick up edits. */
  async function recover(serverTime: string): Promise<void> {
    const since = lastSyncAt;
    lastSyncAt = serverTime;
    try {
      await loadConversations();
      const state = store.getState();
      await Promise.all(
        Object.entries(state.messages)
          .filter(([, list]) => list.loaded)
          .map(async ([conversationId, list]) => {
            await fetchGap(conversationId, lastSeq(list));
            if (since) {
              const changed = await api.listMessages(conversationId, { updated_since: since });
              update((s) =>
                patchMessages(s, conversationId, (current) => ({
                  ...current,
                  items: changed.results.reduce(
                    (items, m) => (items.some((i) => i.id === m.id) ? replaceMessage(items, m) : items),
                    current.items,
                  ),
                })),
              );
            }
          }),
      );
    } catch (error) {
      report(error);
    }
  }

  function ensureTypingSweep(): void {
    if (typingSweep) return;
    typingSweep = setInterval(() => {
      const now = Date.now();
      let active = false;
      update((s) => {
        let changed = false;
        const typing: ChatState['typing'] = {};
        for (const [cid, users] of Object.entries(s.typing)) {
          const kept = Object.fromEntries(Object.entries(users).filter(([, expires]) => expires > now));
          if (Object.keys(kept).length !== Object.keys(users).length) changed = true;
          if (Object.keys(kept).length) active = true;
          typing[cid] = kept;
        }
        return changed ? { ...s, typing } : s;
      });
      if (!active && typingSweep) {
        clearInterval(typingSweep);
        typingSweep = null;
      }
    }, 1000);
  }

  /* --------------------------------- loading ---------------------------------- */

  async function start(): Promise<void> {
    if (disposed) throw new Error('ChatClient was disposed.');
    started ??= (async () => {
      const config = await api.config();
      update((s) => ({ ...s, config, me: config.user }));
      socket.connect();
      await loadConversations();
    })().catch((error) => {
      started = null;
      throw report(error);
    });
    return started;
  }

  async function loadConversations(opts: { more?: boolean; signal?: AbortSignal } = {}): Promise<void> {
    const before = opts.more ? store.getState().list.cursor : null;
    if (opts.more && !before) return;
    update((s) => ({ ...s, list: { ...s.list, loading: true, error: null } }));
    try {
      const page = await api.listConversations({ before, limit: 50, signal: opts.signal });
      update((s) => {
        const next = upsertConversations(s, page.results, Boolean(opts.more));
        return {
          ...next,
          list: {
            ...next.list,
            loaded: true,
            loading: false,
            hasMore: page.has_more,
            cursor: page.next_cursor,
          },
        };
      });
    } catch (error) {
      const chatError = report(error);
      update((s) => ({ ...s, list: { ...s.list, loading: false, error: chatError } }));
      throw chatError;
    }
  }

  async function refreshConversation(id: string): Promise<Conversation | null> {
    try {
      const { conversation } = await api.getConversation(id);
      update((s) => upsertConversations(s, [conversation]));
      return conversation;
    } catch (error) {
      const chatError = report(error);
      if (chatError.status === 404) update((s) => removeConversation(s, id));
      return null;
    }
  }

  async function loadMessages(conversationId: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
    const current = store.getState().messages[conversationId];
    if (current?.loaded || current?.loading) return;
    update((s) => patchMessages(s, conversationId, (list) => ({ ...list, loading: true, error: null })));
    try {
      const page = await api.listMessages(conversationId, { limit: pageSize, signal: opts.signal });
      update((s) =>
        patchMessages(s, conversationId, (list) => ({
          ...list,
          items: mergeMessages(list.items, page.results, meId()),
          loaded: true,
          loading: false,
          hasMoreBefore: page.has_more,
        })),
      );
    } catch (error) {
      const chatError = report(error);
      update((s) =>
        patchMessages(s, conversationId, (list) => ({ ...list, loading: false, error: chatError })),
      );
    }
  }

  async function loadOlderMessages(conversationId: string): Promise<void> {
    const list = store.getState().messages[conversationId];
    if (!list?.loaded || list.loading || !list.hasMoreBefore) return;
    const oldest = list.items.find((m) => m.status === 'sent');
    update((s) => patchMessages(s, conversationId, (l) => ({ ...l, loading: true })));
    try {
      const page = await api.listMessages(conversationId, { before: oldest?.seq, limit: pageSize });
      update((s) =>
        patchMessages(s, conversationId, (l) => ({
          ...l,
          items: mergeMessages(l.items, page.results, meId()),
          loading: false,
          hasMoreBefore: page.has_more,
        })),
      );
    } catch (error) {
      const chatError = report(error);
      update((s) => patchMessages(s, conversationId, (l) => ({ ...l, loading: false, error: chatError })));
    }
  }

  /* --------------------------------- sending ---------------------------------- */

  function outgoingFiles(opts: SendMessageOptions): File[] {
    return opts.voice ? [opts.voice.file] : (opts.files ?? []);
  }

  function localMessage(conversationId: string, clientId: string, opts: SendMessageOptions): ChatMessage {
    const me = store.getState().me;
    // Images and voice notes get an object URL so they render (and play) before upload.
    const previewable = (file: File) =>
      (file.type.startsWith('image/') || opts.voice !== undefined) &&
      typeof URL.createObjectURL === 'function';
    const attachments: LocalAttachment[] = outgoingFiles(opts).map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      progress: 0,
      uploaded: null,
      previewUrl: previewable(file) ? URL.createObjectURL(file) : null,
      voice: opts.voice ? { duration: opts.voice.duration, waveform: opts.voice.waveform } : null,
    }));
    const replyTo = opts.replyToId
      ? (store.getState().messages[conversationId]?.items.find((m) => m.id === opts.replyToId) ?? null)
      : null;
    return {
      id: `local:${clientId}`,
      conversation_id: conversationId,
      seq: Number.MAX_SAFE_INTEGER,
      client_id: clientId,
      sender: me,
      body: (opts.body ?? '').trim(),
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      is_deleted: false,
      reply_to: replyTo
        ? {
            id: replyTo.id,
            seq: replyTo.seq,
            conversation_id: conversationId,
            sender: replyTo.sender,
            body: replyTo.body.slice(0, 280),
            is_deleted: replyTo.is_deleted,
            kind: replyTo.kind,
          }
        : null,
      forwarded_from: null,
      pinned_at: null,
      attachments: [],
      sticker: opts.sticker ?? null,
      reactions: [],
      kind: opts.sticker ? 'sticker' : opts.voice ? 'voice' : 'text',
      status: 'pending',
      error: null,
      localAttachments: attachments,
    };
  }

  async function sendMessage(conversationId: string, opts: SendMessageOptions): Promise<ChatMessage> {
    const clientId = createClientId();
    const local = localMessage(conversationId, clientId, opts);
    const outgoing = outgoingFiles(opts);
    if (outgoing.length) files.set(clientId, outgoing);
    update((s) => patchMessages(s, conversationId, (list) => ({ ...list, items: [...list.items, local] })));
    return deliver(conversationId, clientId);
  }

  function findLocal(conversationId: string, clientId: string): ChatMessage | undefined {
    return store
      .getState()
      .messages[conversationId]?.items.find((m) => m.status !== 'sent' && m.client_id === clientId);
  }

  async function deliver(conversationId: string, clientId: string): Promise<ChatMessage> {
    const setLocal = (patch: Partial<ChatMessage>) =>
      update((s) =>
        patchMessages(s, conversationId, (list) => ({
          ...list,
          items: patchLocal(list.items, clientId, patch),
        })),
      );
    let local = findLocal(conversationId, clientId);
    if (!local)
      throw new ChatError({ kind: 'http', code: 'not_found', message: 'Message is no longer pending.' });
    setLocal({ status: 'pending', error: null });
    try {
      // 1. Upload attachments that are not uploaded yet (retries skip finished ones).
      const originals = files.get(clientId) ?? [];
      const uploads = await Promise.all(
        local.localAttachments.map(async (item, index) => {
          if (item.uploaded) return item.uploaded;
          const file = originals[index];
          if (!file)
            throw new ChatError({
              kind: 'http',
              code: 'file_missing',
              message: 'The file is no longer available.',
            });
          const { attachment } = await api.uploadAttachment(conversationId, file, {
            voice: item.voice ?? undefined,
            onProgress: (progress) => {
              const current = findLocal(conversationId, clientId);
              if (!current) return;
              setLocal({
                localAttachments: current.localAttachments.map((a, i) =>
                  i === index ? { ...a, progress } : a,
                ),
              });
            },
          });
          const current = findLocal(conversationId, clientId);
          if (current) {
            setLocal({
              localAttachments: current.localAttachments.map((a, i) =>
                i === index ? { ...a, progress: 1, uploaded: attachment } : a,
              ),
            });
          }
          return attachment;
        }),
      );
      local = findLocal(conversationId, clientId) ?? local;
      const payload = {
        body: local.body,
        client_id: clientId,
        reply_to_id: local.reply_to?.id ?? null,
        attachment_ids: uploads.map((a) => a.id),
        sticker_id: local.sticker?.id ?? null,
      };
      // 2. Prefer the socket; on a missing ack retry over HTTP with the same client_id.
      //    The server deduplicates by client_id, so the retry cannot create a duplicate.
      let message: Message;
      try {
        if (!socket.isOpen())
          throw new ChatError({ kind: 'socket', code: 'not_connected', message: 'Not connected.' });
        const ack = await socket.request<{ message: Message }>({
          type: 'message.send',
          request_id: `send:${clientId}`,
          conversation_id: conversationId,
          ...payload,
        });
        message = ack.message;
      } catch (error) {
        const chatError = ChatError.from(error);
        if (
          chatError.kind === 'socket' &&
          chatError.code !== 'not_connected' &&
          chatError.code !== 'connection_lost' &&
          chatError.code !== 'disconnected'
        ) {
          throw chatError; // validation/permission error from the server: do not retry
        }
        message = (await api.sendMessage(conversationId, payload)).message;
      }
      onMessageCreated(message);
      update((s) =>
        patchMessages(s, conversationId, (list) => ({
          ...list,
          items: mergeMessages(list.items, [message], meId()),
        })),
      );
      releaseLocal(local);
      files.delete(clientId);
      return (
        store.getState().messages[conversationId]?.items.find((m) => m.id === message.id) ?? {
          ...message,
          status: 'sent',
          error: null,
          localAttachments: [],
        }
      );
    } catch (error) {
      const chatError = report(error);
      setLocal({ status: 'failed', error: chatError });
      throw chatError;
    }
  }

  function releaseLocal(local: ChatMessage): void {
    for (const item of local.localAttachments) {
      if (item.previewUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(item.previewUrl);
    }
  }

  async function flushPending(): Promise<void> {
    // Messages left pending by a dropped connection are retried with their client_id.
    for (const [conversationId, list] of Object.entries(store.getState().messages)) {
      for (const item of list.items) {
        if (item.status === 'failed' && item.error?.retryable && item.error.kind !== 'http') {
          void deliver(conversationId, item.client_id).catch(() => undefined);
        }
      }
    }
  }

  async function retryMessage(conversationId: string, clientId: string): Promise<ChatMessage | null> {
    if (!findLocal(conversationId, clientId)) return null;
    return deliver(conversationId, clientId);
  }

  function discardMessage(conversationId: string, clientId: string): void {
    const local = findLocal(conversationId, clientId);
    if (!local) return;
    releaseLocal(local);
    files.delete(clientId);
    for (const item of local.localAttachments) {
      if (item.uploaded) void api.discardAttachment(item.uploaded.id).catch(() => undefined);
    }
    update((s) =>
      patchMessages(s, conversationId, (list) => ({
        ...list,
        items: list.items.filter((m) => !(m.status !== 'sent' && m.client_id === clientId)),
      })),
    );
  }

  /* -------------------------------- mutations --------------------------------- */

  function applyMessage(message: Message): Message {
    handleEvent({ type: 'message.updated', conversation_id: message.conversation_id, message });
    return message;
  }

  function guard<T>(promise: Promise<T>): Promise<T> {
    return promise.catch((error) => {
      throw report(error);
    });
  }

  const client: ChatClient = {
    store,
    api,
    socket,
    getState: store.getState,
    subscribe: store.subscribe,
    on: (event, listener) => emitter.on(event, listener),
    start,
    connect: () => socket.connect(),
    disconnect: () => socket.disconnect(),
    dispose() {
      if (disposed) return;
      disposed = true; // first: nothing may update the store after this point
      socket.dispose();
      for (const timer of readTimers.values()) clearTimeout(timer);
      readTimers.clear();
      if (typingSweep) clearInterval(typingSweep);
      for (const url of blobUrls.values()) URL.revokeObjectURL?.(url);
      blobUrls.clear();
      for (const list of Object.values(store.getState().messages)) list.items.forEach(releaseLocal);
      emitter.clear();
    },
    loadConversations,
    refreshConversation,
    loadMessages,
    loadOlderMessages,
    sendMessage,
    retryMessage,
    discardMessage,
    editMessage: (id, body) => guard(api.editMessage(id, body).then((r) => applyMessage(r.message))),
    deleteMessage: (id) =>
      guard(
        api.deleteMessage(id).then((r) => {
          handleEvent({
            type: 'message.deleted',
            conversation_id: r.message.conversation_id,
            message: r.message,
          });
          return r.message;
        }),
      ),
    async toggleReaction(messageId, emoji) {
      const result = await guard(api.toggleReaction(messageId, emoji));
      const conversationId = Object.keys(store.getState().messages).find((cid) =>
        store.getState().messages[cid]!.items.some((m) => m.id === messageId),
      );
      if (conversationId) {
        handleEvent({
          type: 'reaction.updated',
          conversation_id: conversationId,
          message_id: messageId,
          seq: 0,
          reactions: result.reactions,
        });
      }
    },
    togglePin: (id) => guard(api.togglePin(id).then((r) => applyMessage(r.message))),
    forwardMessage: (messageId, conversationId) =>
      guard(
        api.forwardMessage(messageId, conversationId, createClientId()).then((r) => {
          onMessageCreated(r.message);
          return r.message;
        }),
      ),
    markRead(conversationId) {
      const existing = readTimers.get(conversationId);
      if (existing) clearTimeout(existing);
      readTimers.set(
        conversationId,
        setTimeout(() => {
          readTimers.delete(conversationId);
          const conversation = store.getState().conversations[conversationId];
          if (!conversation) return;
          const seq = Math.max(conversation.last_seq, lastSeq(store.getState().messages[conversationId]));
          if (seq <= conversation.my_last_read_seq && conversation.unread_count === 0) return;
          update((s) => ({
            ...s,
            conversations: {
              ...s.conversations,
              [conversationId]: { ...conversation, my_last_read_seq: seq, unread_count: 0 },
            },
          }));
          const viaSocket = socket.isOpen()
            ? socket.request({ type: 'read.mark', conversation_id: conversationId, seq })
            : Promise.reject(new Error('offline'));
          viaSocket.catch(() => api.markRead(conversationId, seq)).catch(report);
        }, READ_DEBOUNCE_MS),
      );
    },
    setTyping(conversationId, typing) {
      const last = typingSentAt.get(conversationId) ?? 0;
      if (typing) {
        if (Date.now() - last < TYPING_RESEND_MS) return;
        if (socket.send({ type: 'typing.start', conversation_id: conversationId }))
          typingSentAt.set(conversationId, Date.now());
      } else if (last) {
        typingSentAt.delete(conversationId);
        socket.send({ type: 'typing.stop', conversation_id: conversationId });
      }
    },
    async startDirect(userId) {
      const { conversation } = await guard(api.startDirect(userId));
      update((s) => upsertConversations(s, [conversation]));
      return conversation;
    },
    async createGroup(input) {
      const { conversation } = await guard(
        api.createGroup({ title: input.title, member_ids: input.memberIds, description: input.description }),
      );
      update((s) => upsertConversations(s, [conversation]));
      return conversation;
    },
    async updateConversation(id, patch) {
      const { conversation } = await guard(api.updateConversation(id, patch));
      update((s) => upsertConversations(s, [conversation]));
      return conversation;
    },
    async addMembers(id, userIds) {
      const { conversation } = await guard(api.addMembers(id, userIds));
      update((s) => upsertConversations(s, [conversation]));
      return conversation;
    },
    async removeMember(id, userId) {
      await guard(api.removeMember(id, userId));
      if (isMe(userId)) update((s) => removeConversation(s, id));
      else await refreshConversation(id);
    },
    leaveConversation(id) {
      const me = meId();
      if (me === null)
        return Promise.reject(
          new ChatError({ kind: 'http', code: 'not_authenticated', message: 'Not signed in.' }),
        );
      return client.removeMember(id, me);
    },
    async changeRole(id, userId, role) {
      const { conversation } = await guard(api.changeRole(id, userId, role));
      update((s) => upsertConversations(s, [conversation]));
      return conversation;
    },
    async loadStickers() {
      const current = store.getState();
      if (current.stickers.loaded || current.stickers.loading || current.config?.features.stickers === false)
        return;
      update((s) => ({ ...s, stickers: { ...s.stickers, loading: true } }));
      try {
        const { results } = await api.listStickers();
        update((s) => ({ ...s, stickers: { packs: results, loaded: true, loading: false } }));
      } catch (error) {
        update((s) => ({ ...s, stickers: { ...s.stickers, loading: false } }));
        throw report(error);
      }
    },
    async resolveAttachmentUrl(attachment, opts = {}) {
      const url = http.resolve(attachment.url);
      if ((auth.credentials ?? 'same-origin') !== 'omit' && !auth.useSocketTicket) return url;
      const cached = blobUrls.get(attachment.id);
      if (cached) return cached;
      const headers = await http.headersFor('GET', url);
      delete headers.Accept;
      const response = await (options.fetch ?? fetch)(url, {
        headers,
        credentials: auth.credentials ?? 'omit',
        signal: opts.signal,
      });
      if (!response.ok) await http.parse(response);
      const objectUrl = URL.createObjectURL(await response.blob());
      blobUrls.set(attachment.id, objectUrl);
      return objectUrl;
    },
    unreadTotal: () => selectUnreadTotal(store.getState()),
  };
  return client;
}
