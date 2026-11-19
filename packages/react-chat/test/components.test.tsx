import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ChatSettings,
  ChatWidget,
  ChatWindow,
  ConnectionBanner,
  ConversationList,
  useChatContext,
} from '../src';
import { FakeWebSocket, makeClient, message, renderWithChat } from './render';

describe('React components', () => {
  beforeEach(() => FakeWebSocket.reset());
  afterEach(() => vi.useRealTimers());

  it('lists conversations with unread badges and selects one', async () => {
    const { client } = makeClient();
    const onSelect = vi.fn();
    await renderWithChat(<ConversationList onSelect={onSelect} activeId="c2" />, client);
    const nav = await screen.findByRole('navigation', { name: 'Conversations' });
    expect(within(nav).getByText('Room')).toBeInTheDocument();
    expect(within(nav).getByLabelText('1 unread')).toBeInTheDocument();
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('Design review');
    await userEvent.click(within(nav).getByText('Room'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
    // Local filtering
    await userEvent.type(screen.getByRole('searchbox'), 'design');
    expect(within(nav).queryByText('Room')).not.toBeInTheDocument();
    client.dispose();
  });

  it('renders message text inertly and with automatic direction', async () => {
    const { client } = makeClient({
      'GET /api/chat/v1/conversations/c1/messages/': () => ({
        results: [
          message(1, { body: '<img src=x onerror=alert(1)> <b>bold</b>' }),
          message(2, { body: 'سلام دنیا https://example.com' }),
        ],
        has_more: false,
        next_cursor: null,
      }),
    });
    const { container } = await renderWithChat(<ChatWindow conversationId="c1" />, client);
    expect(await screen.findByText('<img src=x onerror=alert(1)> <b>bold</b>')).toBeInTheDocument();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    const link = screen.getByRole('link', { name: 'https://example.com' });
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link.closest('p')).toHaveAttribute('dir', 'auto');
    client.dispose();
  });

  it('sends with Enter, keeps Shift+Enter as newline, and shows the optimistic message', async () => {
    const { client } = makeClient();
    await renderWithChat(<ChatWindow conversationId="c1" />, client);
    const box = await screen.findByRole('textbox', { name: 'Write a message…' });
    await userEvent.type(box, 'first line{Shift>}{Enter}{/Shift}second');
    expect(box).toHaveValue('first line\nsecond');
    await userEvent.keyboard('{Enter}');
    expect(box).toHaveValue('');
    const sent = FakeWebSocket.last.lastSent('message.send') as {
      body: string;
      client_id: string;
      request_id: string;
    };
    expect(sent.body).toBe('first line\nsecond');
    expect(await screen.findByLabelText('Sending…')).toBeInTheDocument();
    act(() =>
      FakeWebSocket.last.emit({
        type: 'ack',
        request_id: sent.request_id,
        data: {
          message: message(3, {
            body: sent.body,
            client_id: sent.client_id,
            sender: { id: 1, display_name: 'Me', username: 'me', avatar_url: null },
          }),
        },
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText('Sending…')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Sent')).toBeInTheDocument();
    client.dispose();
  });

  it('shows retry for failed messages and retries with the same client id', async () => {
    let attempts = 0;
    const { client, calls } = makeClient({
      'POST /api/chat/v1/conversations/c1/messages/': (_u, init) => {
        attempts += 1;
        const body = JSON.parse(String(init.body));
        if (attempts === 1)
          return new Response(
            JSON.stringify({ error: { code: 'server_error', message: 'Server unavailable' } }),
            { status: 503 },
          );
        return {
          message: message(3, {
            body: body.body,
            client_id: body.client_id,
            sender: { id: 1, display_name: 'Me', username: 'me', avatar_url: null },
          }),
        };
      },
    });
    await renderWithChat(<ChatWindow conversationId="c1" />, client);
    act(() => FakeWebSocket.last.serverClose(4401)); // no socket → HTTP path, and no reconnect
    const box = await screen.findByRole('textbox', { name: 'Write a message…' });
    await userEvent.type(box, 'hello{Enter}');
    expect(await screen.findByText('Server unavailable')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(screen.queryByText('Server unavailable')).not.toBeInTheDocument());
    const posts = calls.filter((c) => c.method === 'POST' && c.url.pathname.endsWith('/messages/'));
    expect(posts).toHaveLength(2);
    expect((posts[0]!.body as { client_id: string }).client_id).toBe(
      (posts[1]!.body as { client_id: string }).client_id,
    );
    client.dispose();
  });

  it('replies via the message menu and cancels with Escape', async () => {
    const { client } = makeClient();
    await renderWithChat(<ChatWindow conversationId="c1" />, client);
    const actions = await screen.findAllByRole('button', { name: 'Message actions' });
    await userEvent.click(actions[0]!);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reply' }));
    expect(screen.getByText(/Replying to Bob/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText(/Replying to Bob/)).not.toBeInTheDocument();
    client.dispose();
  });

  it('shows typing users from socket events', async () => {
    const { client } = makeClient();
    await renderWithChat(<ChatWindow conversationId="c1" />, client);
    await screen.findByText('message 1');
    act(() =>
      FakeWebSocket.last.emit({
        type: 'typing.updated',
        conversation_id: 'c1',
        user_id: 2,
        is_typing: true,
        expires_in: 6,
      }),
    );
    expect(await screen.findAllByText('Bob is typing')).not.toHaveLength(0);
    client.dispose();
  });

  it('marks the conversation read when the latest messages are visible', async () => {
    const { client } = makeClient();
    await renderWithChat(<ChatWindow conversationId="c1" />, client);
    await screen.findByText('message 2');
    await waitFor(
      () => expect(FakeWebSocket.last.lastSent('read.mark')).toMatchObject({ conversation_id: 'c1', seq: 2 }),
      { timeout: 1000 },
    );
    client.dispose();
  });

  it('widget: launcher badge, open, navigate, close with Escape', async () => {
    const { client } = makeClient();
    await renderWithChat(<ChatWidget />, client);
    const launcher = await screen.findByRole('button', { name: 'Open chat (1 unread)' });
    await userEvent.click(launcher);
    const panel = screen.getByRole('dialog', { name: 'Conversations' });
    await userEvent.click(within(panel).getByText('Room'));
    expect(await within(panel).findByText('message 1')).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Back' }));
    expect(within(panel).getByText('Design review')).toBeInTheDocument();
    within(panel).getByText('Design review').closest('button')!.focus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Conversations' })).not.toBeInTheDocument();
    client.dispose();
  });

  it('connection banner appears while reconnecting', async () => {
    const { client } = makeClient();
    await renderWithChat(<ConnectionBanner />, client);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => FakeWebSocket.last.serverClose(1006));
    expect(await screen.findByText(/Reconnecting/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeInTheDocument();
    client.dispose();
  });

  it('settings toggle preferences and theme tokens reach the root', async () => {
    const { client } = makeClient();
    function Probe() {
      const { preferences, resolvedTheme } = useChatContext();
      return <output data-testid="prefs">{`${preferences.enterToSend}-${resolvedTheme}`}</output>;
    }
    const { container } = await renderWithChat(
      <>
        <ChatSettings />
        <Probe />
        <ConversationList />
      </>,
      client,
      { tokens: { primary: '#0ea5e9' } },
    );
    await userEvent.click(screen.getByRole('switch', { name: /Press Enter to send/ }));
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getByTestId('prefs')).toHaveTextContent('false-dark');
    const root = container.querySelector('nav.rc-root') as HTMLElement;
    expect(root.dataset.rcTheme).toBe('dark');
    expect(root.style.getPropertyValue('--rc-primary')).toBe('#0ea5e9');
    client.dispose();
  });
});

describe('ChatProvider', () => {
  beforeEach(() => FakeWebSocket.reset());

  it('throws a helpful error outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<ConversationList />)).toThrow('inside <ChatProvider>');
  });
});

describe('utils', () => {
  it('detects text direction from the first strong character', async () => {
    const { textDirection, tokenize } = await import('../src');
    expect(textDirection('سلام world')).toBe('rtl');
    expect(textDirection('  123 hello سلام')).toBe('ltr');
    expect(textDirection('שלום')).toBe('rtl');
    expect(tokenize('see https://a.example/x?y=1. ok')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'link', value: 'https://a.example/x?y=1', href: 'https://a.example/x?y=1' },
      { type: 'text', value: '. ok' },
    ]);
    expect(tokenize('javascript:alert(1)')).toEqual([{ type: 'text', value: 'javascript:alert(1)' }]);
  });
});

describe('useCreateChatClient', () => {
  it('is safe under StrictMode: the surviving client is live, discarded ones are disposed', async () => {
    const { StrictMode } = await import('react');
    const { useCreateChatClient, ChatProvider: Provider, ConversationList: List } = await import('../src');
    const { makeClient } = await import('./render');
    const created: ReturnType<typeof makeClient>['client'][] = [];
    function Host() {
      const client = useCreateChatClient(() => {
        const { client: c } = makeClient();
        created.push(c);
        return c;
      }, []);
      return client ? (
        <Provider client={client} storageKey={null}>
          <List />
        </Provider>
      ) : null;
    }
    FakeWebSocket.reset();
    const view = render(
      <StrictMode>
        <Host />
      </StrictMode>,
    );
    await waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThan(0));
    act(() => FakeWebSocket.last.ready());
    expect(await screen.findByText('Room')).toBeInTheDocument();
    expect(created.length).toBe(2); // StrictMode double-invokes the effect
    view.unmount();
    expect(FakeWebSocket.instances.every((ws) => ws.closedWith !== null || ws.readyState === 3)).toBe(true);
  });
});
