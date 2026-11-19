/** All URLs are relative to the app base so the build also works under a sub-path. */
const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export const urls = {
  auth: import.meta.env.VITE_AUTH_API_URL ?? `${base}/api/auth`,
  chat: import.meta.env.VITE_CHAT_API_URL ?? `${base}/api/chat/v1`,
  ws: import.meta.env.VITE_CHAT_WS_URL ?? `${base}/ws/chat/v1`,
};

export const PREFERENCES_KEY = 'talkio:preferences';
