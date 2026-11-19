import { useChatContext } from '@realtime-chat/react';
import { useEffect } from 'react';

/** Keeps the document-level token scope in sync with the chat theme preference. */
export function ThemeSync() {
  const { resolvedTheme } = useChatContext();
  useEffect(() => {
    document.documentElement.dataset.rcTheme = resolvedTheme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolvedTheme === 'dark' ? '#0f1117' : '#ffffff');
  }, [resolvedTheme]);
  return null;
}
