import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { ChatProvider, ChatWindow, toWaveform, VoicePlayer } from '../src';
import { FakeWebSocket, makeClient, message, renderWithChat } from './render';

const sticker = {
  id: 's1',
  pack_id: 'p1',
  emoji: '😀',
  content_type: 'image/png',
  width: 8,
  height: 8,
  url: '/api/chat/v1/stickers/s1/file/',
};

describe('media components', () => {
  beforeEach(() => FakeWebSocket.reset());

  it('inserts emoji from the picker at the caret', async () => {
    const { client } = makeClient();
    await renderWithChat(<ChatWindow conversationId="c1" />, client);
    const box = await screen.findByRole('textbox', { name: 'Write a message…' });
    await userEvent.type(box, 'Hi ');
    await userEvent.click(screen.getByRole('button', { name: /Emoji/ }));
    const search = await screen.findByRole('searchbox', { name: 'Search emoji' });
    await userEvent.type(search, 'party popper');
    await userEvent.click(await screen.findByRole('button', { name: 'party popper' }));
    expect(box).toHaveValue('Hi 🎉');
    client.dispose();
  });

  it('sends a sticker from the sticker tab', async () => {
    const { client, calls } = makeClient({
      'GET /api/chat/v1/stickers/': () => ({ results: [{ id: 'p1', name: 'Basics', stickers: [sticker] }] }),
    });
    await renderWithChat(<ChatWindow conversationId="c1" />, client);
    await userEvent.click(await screen.findByRole('button', { name: /Emoji/ }));
    await userEvent.click(screen.getByRole('tab', { name: 'Stickers' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sticker 😀' }));
    await waitFor(() =>
      expect(FakeWebSocket.last.lastSent('message.send')).toMatchObject({ sticker_id: 's1', body: '' }),
    );
    expect(calls.some((c) => c.url.pathname.endsWith('/stickers/'))).toBe(true);
    client.dispose();
  });

  it('renders sticker and voice messages', async () => {
    const voice = {
      id: 'a1',
      conversation_id: 'c1',
      message_id: 'm2',
      name: 'voice.webm',
      content_type: 'audio/webm',
      size: 10,
      width: null,
      height: null,
      url: '/api/chat/v1/attachments/a1/download/',
      thumbnail_url: null,
      is_voice: true,
      duration: 75,
      waveform: [10, 60, 100],
      created_at: null,
    };
    const { client } = makeClient({
      'GET /api/chat/v1/conversations/c1/messages/': () => ({
        results: [
          message(1, { body: '', sticker, kind: 'sticker' }),
          message(2, { body: '', attachments: [voice], kind: 'voice' }),
        ],
        has_more: false,
        next_cursor: null,
      }),
    });
    await renderWithChat(<ChatWindow conversationId="c1" />, client);
    expect(await screen.findByRole('img', { name: '😀' })).toHaveAttribute(
      'src',
      'http://localhost/api/chat/v1/stickers/s1/file/',
    );
    const slider = screen.getByRole('slider', { name: 'Voice message' });
    expect(slider).toHaveAttribute('aria-valuetext', '0:00 / 1:15');
    expect(within(slider.parentElement!).getByText('1:15')).toBeInTheDocument();
    client.dispose();
  });

  it('voice player cycles playback speed', async () => {
    const { client } = makeClient();
    render(
      <ChatProvider client={client} storageKey={null} autoStart={false}>
        <VoicePlayer src="blob:x" duration={5} waveform={[1, 2, 3]} />
      </ChatProvider>,
    );
    const speed = screen.getByRole('button', { name: 'Playback speed 1×' });
    await userEvent.click(speed);
    expect(screen.getByRole('button', { name: 'Playback speed 1.5×' })).toBeInTheDocument();
    act(() => client.dispose());
  });

  it('reduces recorded levels to a normalized waveform', () => {
    expect(toWaveform([])).toEqual([]);
    const wave = toWaveform(
      Array.from({ length: 640 }, (_, i) => (i % 64) / 64),
      64,
    );
    expect(wave).toHaveLength(64);
    expect(Math.max(...wave)).toBe(100);
    expect(wave.every((v) => v >= 0 && v <= 100)).toBe(true);
  });
});

describe('Telegram-style emoji details', () => {
  beforeEach(() => FakeWebSocket.reset());

  it('detects emoji-only text', async () => {
    const { emojiOnlyCount } = await import('../src');
    expect(emojiOnlyCount('🎉')).toBe(1);
    expect(emojiOnlyCount(' 👍🏽  ❤️ ')).toBe(2);
    expect(emojiOnlyCount('👨‍👩‍👧🇮🇷😀')).toBe(3);
    expect(emojiOnlyCount('😀😀😀😀')).toBe(0);
    expect(emojiOnlyCount('hi 😀')).toBe(0);
    expect(emojiOnlyCount('123')).toBe(0);
    expect(emojiOnlyCount('')).toBe(0);
  });

  it('renders short emoji-only messages large without a bubble', async () => {
    const { client } = makeClient({
      'GET /api/chat/v1/conversations/c1/messages/': () => ({
        results: [message(1, { body: '🎉' }), message(2, { body: 'party 🎉' })],
        has_more: false,
        next_cursor: null,
      }),
    });
    await renderWithChat(<ChatWindow conversationId="c1" />, client);
    const big = await screen.findByLabelText('🎉');
    expect(big.tagName).toBe('P');
    expect(big.closest('[class*="rc:bg-in"]')).toBeNull(); // no bubble
    expect((big.firstElementChild as HTMLElement).style.fontSize).toBe(`${56 * 0.92}px`);
    expect(screen.getByText('party 🎉').closest('[class*="rc:bg-in"]')).not.toBeNull();
    client.dispose();
  });

  it('offers skin-tone variants on right-click and remembers the choice', async () => {
    localStorage.clear();
    const { client } = makeClient();
    await renderWithChat(<ChatWindow conversationId="c1" />, client);
    const box = await screen.findByRole('textbox', { name: 'Write a message…' });
    await userEvent.click(screen.getByRole('button', { name: /Emoji/ }));
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search emoji' }), 'waving hand');
    const wave = await screen.findByRole('button', { name: 'waving hand' });
    await userEvent.pointer({ keys: '[MouseRight]', target: wave });
    await userEvent.click(await screen.findByRole('menuitem', { name: 'waving hand: medium skin tone' }));
    expect((box as HTMLTextAreaElement).value.startsWith('👋🏽')).toBe(true);
    expect(screen.getByRole('button', { name: 'waving hand' })).toHaveTextContent('👋🏽');
    client.dispose();
  });
});

describe('image emoji', () => {
  beforeEach(() => FakeWebSocket.reset());

  it('maps emoji to Twemoji file names', async () => {
    const { emojiCodepoints, splitEmoji } = await import('../src');
    expect(emojiCodepoints('😀')).toBe('1f600');
    expect(emojiCodepoints('❤️')).toBe('2764');
    expect(emojiCodepoints('👋🏽')).toBe('1f44b-1f3fd');
    expect(emojiCodepoints('❤️‍🔥')).toBe('2764-fe0f-200d-1f525');
    expect(emojiCodepoints('🇮🇷')).toBe('1f1ee-1f1f7');
    expect(splitEmoji('hi 👨‍👩‍👧 ok')).toEqual([
      { emoji: false, text: 'hi ' },
      { emoji: true, text: '👨‍👩‍👧' },
      { emoji: false, text: ' ok' },
    ]);
    expect(splitEmoji('room 101')).toEqual([{ emoji: false, text: 'room 101' }]);
  });

  it('renders emoji in messages, previews and the picker as images', async () => {
    const { client } = makeClient({
      'GET /api/chat/v1/conversations/c1/messages/': () => ({
        results: [message(1, { body: 'nice 🎉 <b>' })],
        has_more: false,
        next_cursor: null,
      }),
    });
    await renderWithChat(<ChatWindow conversationId="c1" />, client, { emoji: { baseUrl: '/emoji/' } });
    const img = await screen.findByRole('img', { name: '🎉' });
    expect(img).toHaveAttribute('src', '/emoji/1f389.svg');
    expect(img.closest('p')).toHaveTextContent('nice <b>');
    await userEvent.click(screen.getByRole('button', { name: /Emoji/ }));
    const smile = await screen.findByRole('button', { name: 'grinning face' });
    expect(within(smile).getByRole('img')).toHaveAttribute('src', '/emoji/1f600.svg');
    client.dispose();
  });
});
