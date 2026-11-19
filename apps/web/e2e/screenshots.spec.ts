/**
 * Captures the screenshots used in the README from the real running app.
 * Run: npx playwright test --project=screenshots (backend seeded with `seed_demo`).
 */
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { login, openConversation } from './helpers';

const out = (name: string) => `../../docs/screenshots/${name}.png`;

async function theme(page: Page, value: 'dark' | 'light') {
  await page.addInitScript(
    (t) =>
      localStorage.setItem(
        'talkio:preferences',
        JSON.stringify({ theme: t, enterToSend: true, compact: false }),
      ),
    value,
  );
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
}

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

test('landing and auth', async ({ page }) => {
  await theme(page, 'dark');
  await page.goto('/');
  await settle(page);
  await page.screenshot({ path: out('landing-dark') });
  await page.goto('/login');
  await settle(page);
  await page.screenshot({ path: out('login') });
});

for (const mode of ['dark', 'light'] as const) {
  test(`workspace ${mode}`, async ({ page }) => {
    await theme(page, mode);
    await page.addInitScript(() => localStorage.setItem('talkio:info-panel', '1'));
    await login(page, 'alice');
    await openConversation(page, 'Product design');
    await expect(page.getByRole('img', { name: 'onboarding-v3.png' })).toBeVisible();
    await settle(page);
    await page.screenshot({ path: out(`workspace-${mode}`) });
  });
}

test('direct message, dialogs and settings', async ({ page }) => {
  await theme(page, 'dark');
  await page.addInitScript(() => localStorage.setItem('talkio:info-panel', '0'));
  await login(page, 'alice');
  await openConversation(page, 'Bahram Karimi');
  await settle(page);
  await page.screenshot({ path: out('direct-message') });
  await page.getByRole('button', { name: 'New group' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New group' });
  await dialog.getByLabel('Group name').fill('Launch crew');
  await dialog.getByRole('option', { name: /Chen Wei/ }).click();
  await dialog.getByRole('option', { name: /Dana Okafor/ }).click();
  await settle(page);
  await page.screenshot({ path: out('new-group-dialog') });
  await page.keyboard.press('Escape');
  await page.goto('/app/settings');
  await settle(page);
  await page.screenshot({ path: out('settings') });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  test('mobile list and conversation', async ({ page }) => {
    await theme(page, 'dark');
    await login(page, 'alice');
    await settle(page);
    await page.screenshot({ path: out('mobile-list') });
    await page
      .getByRole('navigation', { name: 'Conversations' })
      .getByRole('link', { name: /Product design/ })
      .click();
    await settle(page);
    await page.screenshot({ path: out('mobile-conversation') });
  });
});

test('media: voice, stickers and emoji picker', async ({ page }) => {
  await theme(page, 'dark');
  await page.addInitScript(() => localStorage.setItem('talkio:info-panel', '0'));
  await login(page, 'alice');
  await openConversation(page, 'Product design');
  await page.getByRole('button', { name: /Emoji/ }).click();
  await page.getByRole('tab', { name: 'Stickers' }).click();
  await page.getByRole('button', { name: 'Sticker 🥳' }).click();
  await openConversation(page, 'Bahram Karimi');
  await expect(page.getByRole('slider', { name: 'Voice message' }).first()).toBeVisible();
  await page.getByRole('button', { name: /Emoji/ }).click();
  await page.getByRole('tab', { name: 'Emoji' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search emoji' })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: out('media') });
  await page.getByRole('tab', { name: 'Stickers' }).click();
  await settle(page);
  await page.screenshot({ path: out('media-stickers') });
});

test('persian', async ({ page }) => {
  await theme(page, 'dark');
  await page.addInitScript(() => localStorage.setItem('talkio:info-panel', '0'));
  await login(page, 'alice');
  await page.evaluate(() => localStorage.setItem('talkio:lang', 'fa'));
  await openConversation(page, 'Product design');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('navigation', { name: 'گفت‌وگوها' })).toBeVisible();
  await settle(page);
  await page.screenshot({ path: out('workspace-fa') });
  await page.goto('/app/settings');
  await settle(page);
  await page.screenshot({ path: out('settings-fa') });
  await page.goto('/');
  await settle(page);
  await page.screenshot({ path: out('landing-fa') });
});
