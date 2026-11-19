import { expect, test } from '@playwright/test';

import { login } from './helpers';

test('mobile: list and conversation are separate screens', async ({ page }) => {
  await login(page, 'alice');
  const list = page.getByRole('navigation', { name: 'Conversations' });
  await expect(list).toBeVisible();
  await list.getByRole('link', { name: /Product design/ }).click();
  await expect(page.getByRole('textbox', { name: 'Write a message…' })).toBeVisible();
  await expect(list).toBeHidden();
  // The bottom tab bar is hidden inside a conversation to give the composer room.
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('navigation', { name: 'Conversations' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
});
