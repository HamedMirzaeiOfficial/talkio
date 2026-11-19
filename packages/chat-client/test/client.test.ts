import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '../src';
import { createChatClient, selectReadBy, selectTypingUsers, selectUnreadTotal } from '../src';
import { config, conversation, FakeWebSocket, fakeFetch, flush, message } from './fakes';

function setup(routes: Parameters<typeof fakeFetch>[0] = {}, opts: { ackTimeoutMs?: number } = {}) {
  const server = fakeFetch({
    'GET /api/chat/v1/config/': () => config,
    'GET /api/chat/v1/conversations/': () => ({
      results: [conversation({ last_seq: 2 })],
      has_more: false,
      next_cursor: null,
    }),
    'GET /api/chat/v1/conversations/c1/messages/': () => ({
      results: [message(1), message(2)],
      has_more: true,
      next_cursor: '1',
    }),
    ...routes,
  });
  const client = createChatClient({
    baseUrl: 'http://localhost/api/chat/v1',
    wsUrl: 'ws://localhost/ws/chat/v1',
    auth: {},
    fetch: server.fetch,
    WebSocket: FakeWebSocket as never,
    reconnect: { minDelayMs: 10, maxDelayMs: 10 },
    ackTimeoutMs: opts.ackTimeoutMs ?? 50,
  });
  return { client, ...server };
}

async function started(routes: Parameters<typeof fakeFetch>[0] = {}, opts: { ackTimeoutMs?: number } = {}) {
  const env = setup(routes, opts);
  await env.client.start();
  FakeWebSocket.last.ready();
  await env.client.loadMessages('c1');
  return env;
}

const mine = (seq: number, clientId: string, extra: Partial<Message> = {}) =>
  message(seq, {
    id: `m${seq}`,
    client_id: clientId,
    sender: { id: 1, display_name: 'Me', username: 'me', avatar_url: null },
    ...extra,
  });

describe('createChatClient', () => {
  beforeEach(() => FakeWebSocket.reset());
  afterEach(() => vi.useRealTimers());

  it('loads config, conversations and history', async () => {
    const { client } = await started();
    const state = client.getState();
    expect(state.me?.id).toBe(1);
    expect(state.list.ids).toEqual(['c1']);
    expect(state.messages.c1?.items.map((m) => m.seq)).toEqual([1, 2]);
    expect(state.messages.c1?.hasMoreBefore).toBe(true);
    expect(state.connection.status).toBe('open');
    client.dispose();
  });

  it('sends optimistically over the socket and reconciles on ack', async () => {
    const { client } = await started();
    const promise = client.sendMessage('c1', { body: ' hello ' });
    await flush();
    const optimistic = client.getState().messages.c1!.items.at(-1)!;
    expect(optimistic).toMatchObject({ status: 'pending', body: 'hello' });
    const sent = FakeWebSocket.last.lastSent('message.send')!;
    expect(sent).toMatchObject({ conversation_id: 'c1', body: 'hello', client_id: optimistic.client_id });
    // The broadcast can arrive before the ack: it must not create a duplicate.
    FakeWebSocket.last.emit({
      type: 'message.created',
      conversation_id: 'c1',
      message: mine(3, optimistic.client_id, { body: 'hello' }),
    });
    FakeWebSocket.last.emit({
      type: 'ack',
      request_id: sent.request_id,
      data: { message: mine(3, optimistic.client_id, { body: 'hello' }) },
    });
    const result = await promise;
    expect(result.status).toBe('sent');
    expect(client.getState().messages.c1!.items.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect(client.getState().conversations.c1!.last_seq).toBe(3);
    client.dispose();
  });

  it('falls back to HTTP with the same client_id when the ack never arrives', async () => {
    const { client, calls } = await started({
      'POST /api/chat/v1/conversations/c1/messages/': (_url, init) => {
        const body = JSON.parse(String(init.body));
        return { message: mine(3, body.client_id), deduplicated: true };
      },
    });
    const result = await client.sendMessage('c1', { body: 'retry me' });
    const wsSend = FakeWebSocket.last.lastSent('message.send')!;
    const httpSend = calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/messages/'))!;
    expect((httpSend.body as { client_id: string }).client_id).toBe(wsSend.client_id);
    expect(result.status).toBe('sent');
    expect(client.getState().messages.c1!.items.filter((m) => m.client_id === wsSend.client_id)).toHaveLength(
      1,
    );
    client.dispose();
  });

  it('marks validation failures as failed without retrying, then allows retry', async () => {
    let fail = true;
    const { client } = await started({
      'POST /api/chat/v1/conversations/c1/messages/': (_u, init) =>
        fail
          ? new Response(JSON.stringify({ error: { code: 'message_too_long', message: 'too long' } }), {
              status: 400,
            })
          : { message: mine(3, JSON.parse(String(init.body)).client_id) },
    });
    FakeWebSocket.last.serverClose(); // force HTTP path
    await expect(client.sendMessage('c1', { body: 'x' })).rejects.toMatchObject({ code: 'message_too_long' });
    const failed = client.getState().messages.c1!.items.at(-1)!;
    expect(failed.status).toBe('failed');
    fail = false;
    await client.retryMessage('c1', failed.client_id);
    expect(client.getState().messages.c1!.items.at(-1)).toMatchObject({ id: 'm3', status: 'sent' });
    client.discardMessage('c1', 'unknown'); // no-op
    client.dispose();
  });

  it('counts unread messages from others and clears them on markRead', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { client, calls } = await started();
    FakeWebSocket.last.emit({ type: 'message.created', conversation_id: 'c1', message: message(3) });
    FakeWebSocket.last.emit({ type: 'message.created', conversation_id: 'c1', message: message(4) });
    expect(client.getState().conversations.c1!.unread_count).toBe(2);
    expect(selectUnreadTotal(client.getState())).toBe(2);
    client.markRead('c1');
    client.markRead('c1'); // debounced into one request
    await vi.advanceTimersByTimeAsync(260);
    const reads = FakeWebSocket.last.sent.filter((e) => e.type === 'read.mark');
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ conversation_id: 'c1', seq: 4 });
    FakeWebSocket.last.emit({ type: 'ack', request_id: reads[0]!.request_id, data: { last_read_seq: 4 } });
    await vi.advanceTimersByTimeAsync(100);
    expect(client.getState().conversations.c1!.unread_count).toBe(0);
    expect(calls.some((c) => c.url.pathname.endsWith('/read/'))).toBe(false);
    client.dispose();
  });

  it('fetches missing messages when a sequence gap is detected', async () => {
    const { client, calls } = await started({
      'GET /api/chat/v1/conversations/c1/messages/': (url) =>
        url.searchParams.get('after') === '2'
          ? { results: [message(3), message(4)], has_more: false, next_cursor: null }
          : { results: [message(1), message(2)], has_more: false, next_cursor: null },
    });
    FakeWebSocket.last.emit({ type: 'message.created', conversation_id: 'c1', message: message(5) });
    await flush();
    await flush();
    expect(calls.some((c) => c.url.searchParams.get('after') === '2')).toBe(true);
    expect(client.getState().messages.c1!.items.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    client.dispose();
  });

  it('recovers after reconnect: refreshes list, fills gaps, applies edits', async () => {
    const edited = message(2, { body: 'edited while away', edited_at: '2026-01-01T01:00:00Z' });
    const { client, calls } = await started({
      'GET /api/chat/v1/conversations/c1/messages/': (url) => {
        if (url.searchParams.get('after') === '2')
          return { results: [message(3)], has_more: false, next_cursor: null };
        if (url.searchParams.get('updated_since'))
          return { results: [edited], has_more: false, next_cursor: null };
        return { results: [message(1), message(2)], has_more: false, next_cursor: null };
      },
    });
    FakeWebSocket.last.serverClose();
    await new Promise((r) => setTimeout(r, 20));
    FakeWebSocket.last.ready({ server_time: '2026-01-01T02:00:00Z' });
    await new Promise((r) => setTimeout(r, 10));
    const items = client.getState().messages.c1!.items;
    expect(items.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(items[1]!.body).toBe('edited while away');
    expect(calls.filter((c) => c.url.pathname === '/api/chat/v1/conversations/').length).toBe(2);
    client.dispose();
  });

  it('tracks typing, presence and read receipts', async () => {
    const { client } = await started();
    const ws = FakeWebSocket.last;
    ws.emit({ type: 'typing.updated', conversation_id: 'c1', user_id: 2, is_typing: true, expires_in: 6 });
    expect(selectTypingUsers(client.getState(), 'c1').map((u) => u.display_name)).toEqual(['Bob']);
    ws.emit({ type: 'typing.updated', conversation_id: 'c1', user_id: 2, is_typing: false, expires_in: 6 });
    expect(selectTypingUsers(client.getState(), 'c1')).toEqual([]);
    ws.emit({
      type: 'presence.updated',
      conversation_id: 'c1',
      user_id: 2,
      online: true,
      last_seen_at: null,
    });
    expect(client.getState().presence['2']?.online).toBe(true);
    ws.emit({ type: 'read.updated', conversation_id: 'c1', user_id: 2, last_read_seq: 2 });
    expect(selectReadBy(client.getState(), mine(2, 'x')).map((m) => m.id)).toEqual([2]);
    ws.emit({ type: 'conversation.removed', conversation_id: 'c1' });
    expect(client.getState().list.ids).toEqual([]);
    client.dispose();
  });

  it('throttles typing.start and sends typing.stop once', async () => {
    const { client } = await started();
    client.setTyping('c1', true);
    client.setTyping('c1', true);
    client.setTyping('c1', false);
    client.setTyping('c1', false);
    const types = FakeWebSocket.last.sent.map((e) => e.type);
    expect(types.filter((t) => t === 'typing.start')).toHaveLength(1);
    expect(types.filter((t) => t === 'typing.stop')).toHaveLength(1);
    client.dispose();
  });

  it('uses a socket ticket when the auth adapter requires it', async () => {
    const server = fakeFetch({
      'GET /api/chat/v1/config/': () => config,
      'GET /api/chat/v1/conversations/': () => ({ results: [], has_more: false, next_cursor: null }),
      'POST /api/chat/v1/ws-ticket/': () => ({ ticket: 'tkt', expires_in: 60 }),
    });
    const client = createChatClient({
      baseUrl: 'http://localhost/api/chat/v1',
      wsUrl: 'ws://localhost/ws/chat/v1',
      auth: { useSocketTicket: true, credentials: 'omit' },
      fetch: server.fetch,
      WebSocket: FakeWebSocket as never,
    });
    await client.start();
    await flush();
    expect(FakeWebSocket.last.url).toBe('ws://localhost/ws/chat/v1/?ticket=tkt');
    client.dispose();
  });

  it('dispose() closes the socket and ignores late events', async () => {
    const { client } = await started();
    const ws = FakeWebSocket.last;
    const listener = vi.fn();
    client.subscribe(listener);
    client.dispose();
    expect(ws.closedWith).toBe(1000);
    ws.emit({ type: 'message.created', conversation_id: 'c1', message: message(9) });
    expect(listener).not.toHaveBeenCalled();
    await expect(client.start()).rejects.toThrow('disposed');
  });
});
