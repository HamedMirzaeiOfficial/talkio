import type { Browser, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export const PASSWORD = process.env.DEMO_PASSWORD ?? 'talkio-demo-2026';

export async function login(page: Page, username: string, password = PASSWORD) {
  await page.goto('/login');
  // With the development code login enabled, the phone tab is shown first.
  const usernameTab = page.getByRole('tab', { name: 'Username' });
  if (await usernameTab.isVisible().catch(() => false)) await usernameTab.click();
  await page.getByLabel('Username or email').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByRole('navigation', { name: 'Conversations' })).toBeVisible();
}

export async function userPage(browser: Browser, username: string) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 880 } });
  const page = await context.newPage();
  await login(page, username);
  return { context, page };
}

export async function openConversation(page: Page, title: string) {
  await page
    .getByRole('navigation', { name: 'Conversations' })
    .getByRole('link', { name: new RegExp(title) })
    .first()
    .click();
  const log = page.getByRole('log');
  await expect(log).toBeVisible();
  // History must be rendered before tests count or compare messages.
  await expect(log.locator('[data-message-id]').first()).toBeVisible();
  await expect(log).toHaveAttribute('aria-busy', 'false');
}

export const unique = (prefix: string) =>
  `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
