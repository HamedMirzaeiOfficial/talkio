import { expect, test } from '@playwright/test';

import { login, openConversation, userPage } from './helpers';

test.use({ permissions: ['microphone'] });

test('emoji picker inserts emoji and any emoji can be a reaction', async ({ page }) => {
  await login(page, 'alice');
  await openConversation(page, 'Engineering');
  const composer = page.getByRole('textbox', { name: 'Write a message…' });
  await composer.fill('Ship it ');
  await page.getByRole('button', { name: /Emoji/ }).click();
  await page.getByRole('searchbox', { name: 'Search emoji' }).fill('rocket');
  await page.getByRole('button', { name: 'rocket', exact: true }).click();
  await expect(composer).toHaveValue('Ship it 🚀');
  await page.keyboard.press('Escape');
  await composer.press('Enter');
  // Emoji render as images (alt text = the emoji), so match the image rather than text.
  const bubble = page
    .locator('[data-message-id]')
    .filter({ hasText: 'Ship it' })
    .filter({ has: page.getByRole('img', { name: '🚀' }) })
    .last();
  await expect(bubble.getByLabel(/Sent|Read/)).toBeVisible();

  await bubble.hover();
  await bubble.getByRole('button', { name: 'Message actions' }).click();
  await page.getByRole('menuitem', { name: 'More reactions' }).click();
  await page.getByRole('searchbox', { name: 'Search emoji' }).fill('melting');
  await page.getByRole('button', { name: 'melting face' }).click();
  await expect(bubble.getByRole('button', { name: '🫠 1' })).toBeVisible();
});

test('stickers are delivered to the other member', async ({ browser }) => {
  const alice = await userPage(browser, 'alice');
  const dana = await userPage(browser, 'dana');
  await openConversation(alice.page, 'Product design');
  await openConversation(dana.page, 'Product design');
  const before = await dana.page.getByRole('log').getByRole('img', { name: '😎' }).count();
  await alice.page.getByRole('button', { name: /Emoji/ }).click();
  await alice.page.getByRole('tab', { name: 'Stickers' }).click();
  await alice.page.getByRole('button', { name: 'Sticker 😎' }).click();
  await expect(dana.page.getByRole('log').getByRole('img', { name: '😎' })).toHaveCount(before + 1);
  await alice.context.close();
  await dana.context.close();
});

test('records, sends and plays back a voice message', async ({ page }) => {
  await login(page, 'alice');
  await openConversation(page, 'Farnaz Ahmadi');
  await expect(page.getByRole('log').getByText('Thanks Farnaz, see you there!')).toBeVisible();
  const voiceBefore = await page.getByRole('log').getByRole('slider', { name: 'Voice message' }).count();
  await page.getByRole('button', { name: 'Record a voice message' }).click();
  const recording = page.getByRole('group', { name: 'Recording' });
  await expect(recording).toBeVisible();
  await expect(recording.getByText('0:02')).toBeVisible({ timeout: 6_000 });
  await recording.getByRole('button', { name: 'Send voice message' }).click();
  const players = page.getByRole('log').getByRole('slider', { name: 'Voice message' });
  await expect(players).toHaveCount(voiceBefore + 1);
  const last = page
    .locator('[data-message-id]')
    .filter({ has: page.getByRole('slider', { name: 'Voice message' }) })
    .last();
  await expect(last.getByLabel(/Sent|Read/)).toBeVisible({ timeout: 10_000 });
  await last.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(last.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  // The conversation list describes the message instead of showing a file name.
  await expect(
    page.getByRole('navigation', { name: 'Conversations' }).getByRole('link', { name: /Farnaz Ahmadi/ }),
  ).toContainText('Voice message');
});

test('cancelling a recording sends nothing', async ({ page }) => {
  await login(page, 'alice');
  await openConversation(page, 'Farnaz Ahmadi');
  await expect(page.getByRole('log').getByText('Thanks Farnaz, see you there!')).toBeVisible();
  const count = await page.locator('[data-message-id]').count();
  await page.getByRole('button', { name: 'Record a voice message' }).click();
  await expect(page.getByRole('group', { name: 'Recording' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Record a voice message' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('[data-message-id]')).toHaveCount(count);
});
