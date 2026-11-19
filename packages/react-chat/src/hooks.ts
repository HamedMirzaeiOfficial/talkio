import type { ChatMessage, ChatState, Conversation, UserId, UserProfile } from '@realtime-chat/client';
import {
  emptyMessages,
  selectConversationList,
  selectPresence,
  selectTypingUsers,
  selectUnreadTotal,
} from '@realtime-chat/client';
import type React from 'react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useChatContext } from './context.js';

export function useChatClient() {
  return useChatContext().client;
}

/** Subscribe to a slice of client state. The selector result is compared with Object.is. */
export function useChatState<T>(selector: (state: ChatState) => T): T {
  const { client } = useChatContext();
  const ref = useRef<{ state: ChatState; value: T } | null>(null);
  const getSnapshot = () => {
    const state = client.getState();
    if (ref.current && ref.current.state === state) return ref.current.value;
    const value = selector(state);
    if (ref.current && Object.is(ref.current.value, value)) {
      ref.current.state = state;
      return ref.current.value;
    }
    ref.current = { state, value };
    return value;
  };
  return useSyncExternalStore(client.subscribe, getSnapshot, getSnapshot);
}

/** Memoize array selectors: returns the previous array when items are identical. */
function useStableArray<T>(selector: (state: ChatState) => T[]): T[] {
  const prev = useRef<T[]>([]);
  return useChatState((state) => {
    const next = selector(state);
    const same = next.length === prev.current.length && next.every((item, i) => item === prev.current[i]);
    if (!same) prev.current = next;
    return prev.current;
  });
}

export function useConversations(): Conversation[] {
  return useStableArray(selectConversationList);
}

export function useConversationList() {
  return useChatState((s) => s.list);
}

export function useConversation(id: string | null | undefined): Conversation | undefined {
  return useChatState((s) => (id ? s.conversations[id] : undefined));
}

export function useMe() {
  return useChatState((s) => s.me);
}

export function useChatConfig() {
  return useChatState((s) => s.config);
}

export function useConnection() {
  return useChatState((s) => s.connection);
}

export function useUnreadTotal(): number {
  return useChatState(selectUnreadTotal);
}

/** Message list for a conversation; loads the latest page on first use. */
export function useMessages(conversationId: string | null | undefined) {
  const client = useChatClient();
  const list = useChatState((s) =>
    conversationId ? (s.messages[conversationId] ?? emptyMessages) : emptyMessages,
  );
  useEffect(() => {
    if (conversationId) void client.loadMessages(conversationId);
  }, [client, conversationId]);
  const loadOlder = useCallback(
    () => (conversationId ? client.loadOlderMessages(conversationId) : Promise.resolve()),
    [client, conversationId],
  );
  return { ...list, loadOlder };
}

export function useTypingUsers(conversationId: string | null | undefined) {
  const me = useMe();
  const users = useStableArray((s) =>
    conversationId ? selectTypingUsers(s, conversationId).filter((u) => String(u.id) !== String(me?.id)) : [],
  );
  return users;
}

export function usePresence(userId: UserId | null | undefined) {
  const online = useChatState((s) => selectPresence(s, userId).online);
  const lastSeen = useChatState((s) => selectPresence(s, userId).last_seen_at);
  return { online, last_seen_at: lastSeen };
}

/** Debounced, cancellable user search. Empty query returns suggested contacts. */
export function useUserSearch(query: string, { enabled = true, delayMs = 200 } = {}) {
  const client = useChatClient();
  const [state, setState] = useState<{ results: UserProfile[]; loading: boolean; error: Error | null }>({
    results: [],
    loading: false,
    error: null,
  });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    const timer = setTimeout(() => {
      client.api
        .searchUsers(query.trim(), { signal: controller.signal })
        .then(({ results }) => setState({ results, loading: false, error: null }))
        .catch((error: Error & { kind?: string }) => {
          if (error.kind !== 'aborted') setState({ results: [], loading: false, error });
        });
    }, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, query, enabled, delayMs]);
  return state;
}

/** Resolve an attachment URL according to the auth mode (cookie URL or blob URL). */
export function useAttachmentUrl(attachment: { id: string; url: string } | null | undefined) {
  const client = useChatClient();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!attachment) return;
    const controller = new AbortController();
    setFailed(false);
    client
      .resolveAttachmentUrl(attachment, { signal: controller.signal })
      .then(setUrl)
      .catch(() => setFailed(true));
    return () => controller.abort();
  }, [client, attachment?.id, attachment?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  return { url, failed };
}

/** Re-render periodically (e.g. relative timestamps, typing expiry). */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs, enabled]);
  return now;
}

export type { ChatMessage };

/**
 * Create a client for the lifetime of a component and dispose it on unmount or when
 * `deps` change. Safe under React StrictMode (which mounts effects twice in development):
 * each mount gets its own client and the discarded one is disposed. Returns null until ready.
 */
export function useCreateChatClient(
  factory: () => import('@realtime-chat/client').ChatClient,
  deps: React.DependencyList,
) {
  const [client, setClient] = useState<import('@realtime-chat/client').ChatClient | null>(null);
  useEffect(() => {
    const instance = factory();
    setClient(instance);
    return () => {
      instance.dispose();
      setClient((current) => (current === instance ? null : current));
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return client;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener?.('change', notify);
      return () => list.removeEventListener?.('change', notify);
    },
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}
