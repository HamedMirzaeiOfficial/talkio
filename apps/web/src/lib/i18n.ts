import { useSyncExternalStore } from 'react';

import fa from '../locales/fa.json';

/*
 * App-level translations (the chat components bring their own: faStrings from @realtime-chat/react).
 * The English source text is the key; a missing Persian entry falls back to readable English.
 * `npm run i18n:check` fails when a t()/msg() string has no entry in src/locales/fa.json.
 *
 * Talkio is a client-only SPA, so the language is known before the first render: the inline script in
 * index.html sets <html lang dir> from the saved choice or the browser language, and this module reads it.
 */

export type Lang = 'en' | 'fa';

export const LANG_KEY = 'talkio:lang';

const FA: Record<string, string> = fa;

function initial(): Lang {
  if (typeof document === 'undefined') return 'en';
  return document.documentElement.lang === 'fa' ? 'fa' : 'en';
}

let current: Lang = initial();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* storage unavailable: the choice still applies until reload */
  }
  current = lang;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  listeners.forEach((listener) => listener());
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getLang,
    getLang,
  );
}

/** Translate `text`, replacing `{name}` placeholders with `vars.name`. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const out = current === 'fa' ? (FA[text] ?? text) : text;
  if (!vars) return out;
  return out.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}

/** Marks a constant for translation; render it later with t(). */
export function msg(text: string): string {
  return text;
}

/** BCP 47 locale for Intl and the chat components: Persian digits and calendar in Persian. */
export function intlLocale(): string {
  return current === 'fa' ? 'fa-IR' : 'en';
}
