import type { HttpClient } from './http.js';
import type {
  Attachment,
  ChatConfig,
  Conversation,
  Member,
  MemberRole,
  Message,
  Page,
  ReactionSummary,
  StickerPack,
  UserId,
  UserProfile,
} from './types.js';

type Signal = { signal?: AbortSignal };
const enc = encodeURIComponent;

export interface SendMessageInput {
  body?: string;
  client_id: string;
  reply_to_id?: string | null;
  attachment_ids?: string[];
  sticker_id?: string | null;
}

export interface HistoryQuery extends Signal {
  before?: number;
  after?: number;
  limit?: number;
  updated_since?: string;
  pinned?: boolean;
}

/** Typed REST endpoints of `/api/chat/v1/`. Every method accepts an AbortSignal. */
export class ChatApi {
  constructor(private readonly http: HttpClient) {}

  config(opts: Signal = {}) {
    return this.http.request<ChatConfig>('/config/', opts);
  }

  socketTicket(opts: Signal = {}) {
    return this.http.request<{ ticket: string; expires_in: number }>('/ws-ticket/', {
      method: 'POST',
      ...opts,
    });
  }

  listConversations(
    query: { before?: string | null; kind?: 'direct' | 'group'; q?: string; limit?: number } & Signal = {},
  ) {
    const { signal, ...params } = query;
    return this.http.request<Page<Conversation>>('/conversations/', { query: params, signal });
  }

  getConversation(id: string, opts: Signal = {}) {
    return this.http.request<{ conversation: Conversation }>(`/conversations/${enc(id)}/`, opts);
  }

  startDirect(userId: UserId, opts: Signal = {}) {
    return this.http.request<{ conversation: Conversation; created: boolean }>('/conversations/', {
      method: 'POST',
      body: { kind: 'direct', user_id: userId },
      ...opts,
    });
  }

  createGroup(input: { title: string; member_ids: UserId[]; description?: string }, opts: Signal = {}) {
    return this.http.request<{ conversation: Conversation; created: boolean }>('/conversations/', {
      method: 'POST',
      body: { kind: 'group', ...input },
      ...opts,
    });
  }

  updateConversation(id: string, patch: { title?: string; description?: string }, opts: Signal = {}) {
    return this.http.request<{ conversation: Conversation }>(`/conversations/${enc(id)}/`, {
      method: 'PATCH',
      body: patch,
      ...opts,
    });
  }

  markRead(id: string, seq: number, opts: Signal = {}) {
    return this.http.request<{ conversation_id: string; last_read_seq: number }>(
      `/conversations/${enc(id)}/read/`,
      {
        method: 'POST',
        body: { seq },
        ...opts,
      },
    );
  }

  listMembers(id: string, opts: Signal = {}) {
    return this.http.request<{ results: Member[] }>(`/conversations/${enc(id)}/members/`, opts);
  }

  addMembers(id: string, userIds: UserId[], opts: Signal = {}) {
    return this.http.request<{ added_user_ids: UserId[]; conversation: Conversation }>(
      `/conversations/${enc(id)}/members/`,
      { method: 'POST', body: { user_ids: userIds }, ...opts },
    );
  }

  changeRole(id: string, userId: UserId, role: MemberRole, opts: Signal = {}) {
    return this.http.request<{ conversation: Conversation }>(
      `/conversations/${enc(id)}/members/${enc(String(userId))}/`,
      {
        method: 'PATCH',
        body: { role },
        ...opts,
      },
    );
  }

  removeMember(id: string, userId: UserId, opts: Signal = {}) {
    return this.http.request<void>(`/conversations/${enc(id)}/members/${enc(String(userId))}/`, {
      method: 'DELETE',
      ...opts,
    });
  }

  listMessages(id: string, query: HistoryQuery = {}) {
    const { signal, pinned, ...params } = query;
    return this.http.request<Page<Message>>(`/conversations/${enc(id)}/messages/`, {
      query: { ...params, pinned: pinned ? 1 : undefined },
      signal,
    });
  }

  sendMessage(id: string, input: SendMessageInput, opts: Signal = {}) {
    return this.http.request<{ message: Message; deduplicated: boolean }>(
      `/conversations/${enc(id)}/messages/`,
      {
        method: 'POST',
        body: input,
        ...opts,
      },
    );
  }

  editMessage(messageId: string, body: string, opts: Signal = {}) {
    return this.http.request<{ message: Message }>(`/messages/${enc(messageId)}/`, {
      method: 'PATCH',
      body: { body },
      ...opts,
    });
  }

  deleteMessage(messageId: string, opts: Signal = {}) {
    return this.http.request<{ message: Message }>(`/messages/${enc(messageId)}/`, {
      method: 'DELETE',
      ...opts,
    });
  }

  toggleReaction(messageId: string, emoji: string, opts: Signal = {}) {
    return this.http.request<{
      message_id: string;
      emoji: string;
      active: boolean;
      reactions: ReactionSummary[];
    }>(`/messages/${enc(messageId)}/reactions/`, { method: 'POST', body: { emoji }, ...opts });
  }

  togglePin(messageId: string, opts: Signal = {}) {
    return this.http.request<{ message: Message; active: boolean }>(`/messages/${enc(messageId)}/pin/`, {
      method: 'POST',
      ...opts,
    });
  }

  forwardMessage(messageId: string, conversationId: string, clientId: string, opts: Signal = {}) {
    return this.http.request<{ message: Message; deduplicated: boolean }>(
      `/messages/${enc(messageId)}/forward/`,
      {
        method: 'POST',
        body: { conversation_id: conversationId, client_id: clientId },
        ...opts,
      },
    );
  }

  searchMessages(q: string, query: { conversation_id?: string; before?: string } & Signal = {}) {
    const { signal, ...params } = query;
    return this.http.request<Page<Message>>('/messages/search/', { query: { q, ...params }, signal });
  }

  searchUsers(q: string, opts: Signal = {}) {
    return this.http.request<{ results: UserProfile[] }>('/users/search/', { query: { q }, ...opts });
  }

  getUser(userId: UserId, opts: Signal = {}) {
    return this.http.request<{ user: UserProfile }>(`/users/${enc(String(userId))}/`, opts);
  }

  uploadAttachment(
    conversationId: string,
    file: Blob & { name?: string },
    opts: Signal & {
      onProgress?: (fraction: number) => void;
      voice?: { duration: number; waveform: number[] };
    } = {},
  ) {
    const form = new FormData();
    form.append('conversation_id', conversationId);
    form.append('file', file, file.name ?? 'file');
    if (opts.voice) {
      form.append('voice', '1');
      form.append('duration', String(opts.voice.duration));
      form.append('waveform', JSON.stringify(opts.voice.waveform));
    }
    return this.http.upload<{ attachment: Attachment }>('/attachments/', form, opts);
  }

  listStickers(opts: Signal = {}) {
    return this.http.request<{ results: StickerPack[] }>('/stickers/', opts);
  }

  discardAttachment(attachmentId: string, opts: Signal = {}) {
    return this.http.request<void>(`/attachments/${enc(attachmentId)}/`, { method: 'DELETE', ...opts });
  }
}
