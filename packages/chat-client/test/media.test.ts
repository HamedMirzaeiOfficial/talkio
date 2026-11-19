import { beforeEach, describe, expect, it } from 'vitest';

import { createChatClient } from '../src';
import { config, conversation, FakeWebSocket, fakeFetch, message } from './fakes';

const me = { id: 1, display_name: 'Me', username: 'me', avatar_url: null };
const sticker = {
  id: 's1',
  pack_id: 'p1',
  emoji: '😀',
  content_type: 'image/png',
  width: 8,
  height: 8,
  url: '/api/chat/v1/stickers/s1/file/',
};

function setup() {
  const server = fakeFetch({
    'GET /api/chat/v1/config/': () => config,
    'GET /api/chat/v1/conversations/': () => ({
      results: [conversation()],
      has_more: false,
      next_cursor: null,
    }),
    'GET /api/chat/v1/conversations/c1/messages/': () => ({
      results: [],
      has_more: false,
      next_cursor: null,
    }),
    'GET /api/chat/v1/stickers/': () => ({ results: [{ id: 'p1', name: 'Basics', stickers: [sticker] }] }),
    'POST /api/chat/v1/attachments/': (_u, init) => {
      const form = init.body as FormData;
      return {
        attachment: {
          id: 'a1',
          conversation_id: 'c1',
          message_id: null,
          name: 'voice.webm',
          content_type: 'audio/webm',
          size: 4,
          width: null,
          height: null,
          url: '/x',
          thumbnail_url: null,
          created_at: null,
          is_voice: form.get('voice') === '1',
          duration: Number(form.get('duration')),
          waveform: JSON.parse(String(form.get('waveform'))),
        },
      };
    },
    'POST /api/chat/v1/conversations/c1/messages/': (_u, init) => {
      const body = JSON.parse(String(init.body));
      return {
        message: message(1, {
          client_id: body.client_id,
          sender: me,
          body: body.body,
          sticker: body.sticker_id ? sticker : null,
          kind: body.sticker_id ? 'sticker' : 'voice',
        }),
      };
    },
  });
  const client = createChatClient({
    baseUrl: 'http://localhost/api/chat/v1',
    wsUrl: 'ws://localhost/ws/chat/v1',
    auth: {},
    fetch: server.fetch,
    WebSocket: FakeWebSocket as never,
  });
  return { client, ...server };
}

describe('media', () => {
  beforeEach(() => FakeWebSocket.reset());

  it('uploads voice notes with duration and waveform metadata', async () => {
    const { client, calls } = setup();
    await client.start();
    await client.loadMessages('c1');
    const file = new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], 'voice.webm', { type: 'audio/webm' });
    const sent = await client.sendMessage('c1', { voice: { file, duration: 2.5, waveform: [1, 50, 100] } });
    const upload = calls.find((c) => c.url.pathname.endsWith('/attachments/'))!;
    const form = upload.body as FormData;
    expect([form.get('voice'), form.get('duration'), form.get('waveform')]).toEqual([
      '1',
      '2.5',
      '[1,50,100]',
    ]);
    const post = calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/messages/'))!;
    expect((post.body as { attachment_ids: string[] }).attachment_ids).toEqual(['a1']);
    expect(sent.status).toBe('sent');
    client.dispose();
  });

  it('sends stickers optimistically and loads packs once', async () => {
    const { client, calls } = setup();
    await client.start();
    await client.loadMessages('c1');
    await client.loadStickers();
    await client.loadStickers();
    expect(calls.filter((c) => c.url.pathname.endsWith('/stickers/'))).toHaveLength(1);
    const pack = client.getState().stickers.packs[0]!;
    const promise = client.sendMessage('c1', { sticker: pack.stickers[0]! });
    expect(client.getState().messages.c1!.items.at(-1)).toMatchObject({
      status: 'pending',
      kind: 'sticker',
      sticker: { id: 's1' },
    });
    await promise;
    const post = calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/messages/'))!;
    expect(post.body).toMatchObject({ sticker_id: 's1', body: '' });
    client.dispose();
  });
});
