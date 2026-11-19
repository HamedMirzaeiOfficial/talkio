import type { ChatClient, ChatError } from '@realtime-chat/client';
import type { CSSProperties, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { ChatStrings } from './strings.js';
import { defaultStrings } from './strings.js';

export type ThemeMode = 'light' | 'dark' | 'system';

/** Token overrides, e.g. `{ primary: '#0ea5e9', radius: '6px' }` → `--rc-primary`. */
export type ThemeTokens = Partial<
  Record<
    | 'bg'
    | 'sidebar'
    | 'surface'
    | 'surface-2'
    | 'border'
    | 'text'
    | 'muted'
    | 'subtle'
    | 'primary'
    | 'primary-fg'
    | 'primary-soft'
    | 'bubble-out'
    | 'bubble-out-fg'
    | 'bubble-in'
    | 'bubble-in-fg'
    | 'danger'
    | 'success'
    | 'warning'
    | 'ring'
    | 'radius'
    | 'radius-bubble'
    | 'font'
    | 'font-rtl',
    string
  >
>;

export interface ChatPreferences {
  theme: ThemeMode;
  enterToSend: boolean;
  compact: boolean;
}

export const defaultPreferences: ChatPreferences = { theme: 'system', enterToSend: true, compact: false };

export interface ChatContextValue {
  client: ChatClient;
  strings: ChatStrings;
  locale: string | undefined;
  preferences: ChatPreferences;
  setPreferences: (patch: Partial<ChatPreferences>) => void;
  /** Resolved theme ('light' | 'dark') after applying 'system'. */
  resolvedTheme: 'light' | 'dark';
  tokens: ThemeTokens | undefined;
  onError: ((error: ChatError) => void) | undefined;
  /** Base URL of Twemoji-compatible SVGs; undefined = native emoji text. */
  emojiBaseUrl: string | undefined;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export interface ChatProviderProps {
  client: ChatClient;
  children: ReactNode;
  /** Start the client (load config/conversations, open the socket) on mount. Default true. */
  autoStart?: boolean;
  /** Controlled preferences. Omit to let the provider manage them (optionally persisted). */
  preferences?: Partial<ChatPreferences>;
  onPreferencesChange?: (preferences: ChatPreferences) => void;
  /** localStorage key for uncontrolled preferences; `null` disables persistence. */
  storageKey?: string | null;
  tokens?: ThemeTokens;
  strings?: Partial<ChatStrings>;
  locale?: string;
  onError?: (error: ChatError) => void;
  /**
   * Render emoji from an image set instead of the OS font, e.g. `{ baseUrl: '/emoji' }`
   * serving `@twemoji/svg` files. Recommended: identical emoji everywhere, no tofu boxes.
   */
  emoji?: { baseUrl: string };
}

function readStored(key: string | null): Partial<ChatPreferences> {
  if (!key || typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<ChatPreferences>;
  } catch {
    return {};
  }
}

function useSystemDark(): boolean {
  const query =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
  const [dark, setDark] = useState(() => query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const listener = (event: MediaQueryListEvent) => setDark(event.matches);
    query.addEventListener?.('change', listener);
    return () => query.removeEventListener?.('change', listener);
  }, [query]);
  return dark;
}

/**
 * Supplies a ChatClient to the component tree. The provider does not own the client:
 * create it outside React, or with `useCreateChatClient()`, which also disposes it.
 */
export function ChatProvider(props: ChatProviderProps) {
  const { client, autoStart = true, storageKey = 'rc:preferences', onError } = props;
  const [internal, setInternal] = useState<ChatPreferences>(() => ({
    ...defaultPreferences,
    ...readStored(storageKey),
  }));
  const preferences = useMemo(() => ({ ...internal, ...props.preferences }), [internal, props.preferences]);
  const systemDark = useSystemDark();

  const setPreferences = useCallback(
    (patch: Partial<ChatPreferences>) => {
      const next = { ...preferences, ...patch };
      if (!props.preferences) {
        setInternal(next);
        if (storageKey && typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(storageKey, JSON.stringify(next));
          } catch {
            /* storage unavailable (private mode) */
          }
        }
      }
      props.onPreferencesChange?.(next);
    },
    [preferences, props, storageKey],
  );

  useEffect(() => {
    if (!autoStart) return;
    client.start().catch(() => undefined); // errors are surfaced through state + onError
  }, [client, autoStart]);

  useEffect(() => (onError ? client.on('error', onError) : undefined), [client, onError]);

  const value = useMemo<ChatContextValue>(
    () => ({
      client,
      strings: { ...defaultStrings, ...props.strings },
      locale: props.locale,
      preferences,
      setPreferences,
      resolvedTheme: preferences.theme === 'system' ? (systemDark ? 'dark' : 'light') : preferences.theme,
      tokens: props.tokens,
      onError,
      emojiBaseUrl: props.emoji?.baseUrl.replace(/\/$/, ''),
    }),
    [
      client,
      props.strings,
      props.locale,
      preferences,
      setPreferences,
      systemDark,
      props.tokens,
      onError,
      props.emoji?.baseUrl,
    ],
  );
  return <ChatContext.Provider value={value}>{props.children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextValue {
  const value = useContext(ChatContext);
  if (!value) throw new Error('Chat components must be rendered inside <ChatProvider>.');
  return value;
}

/**
 * Props for any element that roots chat UI (including portalled menus/dialogs):
 * applies the token scope, theme and overrides without touching host styles.
 */
export function useThemeRoot(className?: string): {
  className: string;
  'data-rc-theme': 'light' | 'dark';
  style: CSSProperties;
} {
  const { resolvedTheme, tokens } = useChatContext();
  const style = useMemo(() => {
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(tokens ?? {})) if (value) vars[`--rc-${key}`] = value;
    return vars as CSSProperties;
  }, [tokens]);
  return { className: className ? `rc-root ${className}` : 'rc-root', 'data-rc-theme': resolvedTheme, style };
}
