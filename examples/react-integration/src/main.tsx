import './host.css';
import '@realtime-chat/react/styles.css';

import { createChatClient, sessionAuth } from '@realtime-chat/client';
import { ChatProvider, ChatWidget, useCreateChatClient } from '@realtime-chat/react';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

/** The host decides who is signed in; chat just reuses that session. */
function useHostSession() {
  const [state, setState] = useState<'loading' | 'signed-in' | 'signed-out'>('loading');
  useEffect(() => {
    fetch('/api/chat/v1/config/', { credentials: 'include' })
      .then((r) => setState(r.ok ? 'signed-in' : 'signed-out'))
      .catch(() => setState('signed-out'));
  }, []);
  return state;
}

function Chat() {
  const client = useCreateChatClient(
    () =>
      createChatClient({
        baseUrl: '/api/chat/v1',
        wsUrl: '/ws/chat/v1',
        auth: sessionAuth({ onUnauthorized: () => window.location.assign('/login/?next=/') }),
      }),
    [],
  );
  if (!client) return null;
  return (
    <ChatProvider
      client={client}
      // Brand the chat without touching the library: tokens only.
      tokens={{
        primary: '#0f766e',
        'bubble-out': '#0f766e',
        'primary-soft': 'rgb(15 118 110 / 0.12)',
        radius: '6px',
      }}
      preferences={{ theme: 'light' }}
      strings={{ conversations: 'Team chat', openChat: 'Open team chat' }}
    >
      <ChatWidget title="Team chat" position="bottom-right" />
    </ChatProvider>
  );
}

function App() {
  const session = useHostSession();
  return (
    <div className="layout">
      <h1>Acme CRM</h1>
      <div className="card">
        <h2>Pipeline</h2>
        <p>
          This page belongs to the host application. Its global styles (serif fonts, square lists, chunky
          buttons) stay exactly as they are after the chat widget is added.
        </p>
        <ul>
          <li>Northwind renewal — negotiation</li>
          <li>Globex expansion — proposal sent</li>
        </ul>
        <button type="button">A host button</button>
      </div>
      {session === 'signed-out' && (
        <div className="card">
          <p>
            <a href="/login/?next=/">Sign in to the host app</a> (examples/django-integration:{' '}
            <code>ann</code> / <code>example-pass</code>) to load the chat.
          </p>
        </div>
      )}
      {session === 'signed-in' && <Chat />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
