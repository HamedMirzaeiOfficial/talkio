import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { ConversationList, defaultStrings, faStrings, formatNumber, formatRelative } from '../src';
import { FakeWebSocket, makeClient, renderWithChat } from './render';

describe('Persian strings', () => {
  beforeEach(() => FakeWebSocket.reset());

  it('translates every key', () => {
    expect(Object.keys(faStrings).sort()).toEqual(Object.keys(defaultStrings).sort());
    for (const [key, value] of Object.entries(faStrings)) {
      // Acronyms (GIF) may stay as they are; everything else must contain Persian letters.
      if (value !== defaultStrings[key as keyof typeof defaultStrings]) continue;
      expect(value).toMatch(/^[A-Z]+$/);
    }
  });

  it('renders the components in Persian', async () => {
    const { client } = makeClient();
    await renderWithChat(<ConversationList />, client, { strings: faStrings, locale: 'fa-IR' });
    const nav = await screen.findByRole('navigation', { name: 'گفت‌وگوها' });
    expect(within(nav).getByRole('searchbox')).toHaveAccessibleName('جست‌وجوی گفت‌وگوها');
  });

  it('formats numbers and relative times for the locale', () => {
    const now = Date.parse('2026-01-02T12:00:00Z');
    expect(formatNumber(12, 'fa-IR')).toBe('۱۲');
    expect(formatRelative('2026-01-02T11:55:00Z', now, 'fa-IR')).toContain('۵');
    expect(formatRelative('2026-01-01T12:00:00Z', now, 'en')).toBe('yesterday');
    expect(formatRelative(null, now, 'fa-IR', faStrings.aWhileAgo)).toBe('مدتی پیش');
  });
});
