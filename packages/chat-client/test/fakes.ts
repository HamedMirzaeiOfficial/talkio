import type { Conversation, Message } from '../src';

/** Scriptable stand-in for the browser WebSocket. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static reset() {
    FakeWebSocket.instances = [];
  }
  static get last(): FakeWebSocket {
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error('no socket');
    return ws;
  }

  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closedWith: number | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.closedWith = code;
    this.serverClose(code);
  }
  // server side
  ready(extra: Partial<Record<string, unknown>> = {}) {
    this.readyState = 1;
    this.emit({
      type: 'connection.ready',
      protocol_version: 1,
      connection_id: 'c1',
      user: user(1, 'Me'),
      conversation_ids: [],
      heartbeat_interval: 30,
      server_time: '2026-01-01T00:00:00Z',
      ...extra,
    });
  }
  emit(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }
  serverClose(code = 1006) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code });
  }
  lastSent(type: string) {
    return [...this.sent].reverse().find((e) => e.type === type);
  }
}

export const user = (id: number, name: string) => ({
  id,
  display_name: name,
  username: name.toLowerCase(),
  avatar_url: null,
});

export function message(seq: number, overrides: Partial<Message> = {}): Message {
  return {
    id: `m${seq}`,
    conversation_id: 'c1',
    seq,
    client_id: `client-${seq}`,
    sender: user(2, 'Bob'),
    body: `message ${seq}`,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, seq)).toISOString(),
    edited_at: null,
    deleted_at: null,
    is_deleted: false,
    reply_to: null,
    forwarded_from: null,
    pinned_at: null,
    attachments: [],
    sticker: null,
    reactions: [],
    kind: 'text',
    ...overrides,
  };
}

export function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'c1',
    kind: 'group',
    title: 'Room',
    description: '',
    created_at: '2026-01-01T00:00:00Z',
    last_seq: 0,
    last_message: null,
    last_activity_at: '2026-01-01T00:00:00Z',
    unread_count: 0,
    my_role: 'member',
    my_last_read_seq: 0,
    member_count: 2,
    peer: null,
    members: [
      {
        ...user(1, 'Me'),
        role: 'member',
        last_read_seq: 0,
        joined_at: null,
        online: true,
        last_seen_at: null,
      },
      {
        ...user(2, 'Bob'),
        role: 'member',
        last_read_seq: 0,
        joined_at: null,
        online: false,
        last_seen_at: null,
      },
    ],
    ...overrides,
  };
}

type Handler = (url: URL, init: RequestInit) => unknown | Promise<unknown>;

/** Route table for a fake fetch. Handlers return a JSON body or a Response. */
export function fakeFetch(routes: Record<string, Handler>) {
  const calls: { method: string; url: URL; body: unknown; headers: Record<string, string> }[] = [];
  const impl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method, url, body, headers: (init.headers ?? {}) as Record<string, string> });
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler)
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'nope' } }), { status: 404 });
    const result = await handler(url, init);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), { status: 200 });
  };
  return { fetch: impl as typeof fetch, calls };
}

export const config = {
  version: '0.1.0',
  protocol_version: 1,
  user: { ...user(1, 'Me'), online: true, last_seen_at: null },
  features: {
    groups: true,
    attachments: true,
    reactions: true,
    user_search: true,
    stickers: true,
    voice: true,
  },
  limits: {
    max_message_length: 4000,
    max_attachment_size: 1000,
    max_attachments_per_message: 10,
    max_group_members: 10,
    edit_window: null,
    max_voice_duration: 600,
  },
  allowed_attachment_types: ['image/png', 'audio/webm'],
  allowed_reactions: null,
  quick_reactions: ['👍', '❤️'],
  presence_ttl: 60,
  typing_timeout: 6,
};

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
