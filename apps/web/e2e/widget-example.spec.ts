/**
 * Embedded mode: examples/react-integration (host app, port 4811) on top of
 * examples/django-integration (host Django with stock auth.User, port 4810).
 */
import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4811', viewport: { width: 1280, height: 820 } });

test('widget works with host auth and does not leak styles either way', async ({ page }) => {
  await page.goto('/login/?next=/');
  await page.getByLabel('Username').fill('ann');
  await page.getByLabel('Password').fill('example-pass');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.goto('/');

  const hostButton = page.getByRole('button', { name: 'A host button' });
  const before = await hostButton.evaluate(
    (el) => getComputedStyle(el).borderRadius + '|' + getComputedStyle(el).fontFamily,
  );

  const launcher = page.getByRole('button', { name: /Open team chat/ });
  await expect(launcher).toBeVisible();
  // Host CSS sets `button { border-radius: 0; font-family: Georgia }` — the launcher keeps its own look.
  expect(await launcher.evaluate((el) => getComputedStyle(el).borderRadius)).not.toBe('0px');
  await launcher.click();

  const panel = page.getByRole('dialog', { name: 'Team chat' });
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Inter');

  // Start a direct chat with a teammate through the host's policy.
  await panel.getByRole('button', { name: 'New conversation' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New conversation' });
  await dialog.getByRole('textbox', { name: 'Search people' }).fill('be');
  await dialog.getByRole('option', { name: /Ben/ }).click();
  const text = `Hello from the widget ${Date.now()}`;
  await panel.getByRole('textbox', { name: 'Write a message…' }).fill(text);
  await panel.getByRole('textbox', { name: 'Write a message…' }).press('Enter');
  await expect(
    panel
      .locator('[data-message-id]')
      .filter({ hasText: text })
      .getByLabel(/Sent|Read/),
  ).toBeVisible();

  // Inner elements keep the widget typography despite the host's `* { font-family: Georgia }`.
  const textStyle = await panel
    .locator('[data-message-id]')
    .filter({ hasText: text })
    .locator('p')
    .first()
    .evaluate((el) => {
      const cs = getComputedStyle(el);
      return { font: cs.fontFamily, lineHeight: cs.lineHeight, margin: cs.marginTop };
    });
  expect(textStyle.font).toContain('Inter');
  expect(textStyle.margin).toBe('0px');
  const heading = await panel
    .getByRole('button', { name: 'Back' })
    .evaluate((el) => getComputedStyle(el).borderRadius);
  expect(heading).not.toBe('0px');

  // Brand token reached the bubble.
  const bubbleColor = await panel
    .locator('[data-message-id]')
    .filter({ hasText: text })
    .locator('.rc\\:bg-out')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bubbleColor).toBe('rgb(15, 118, 110)');

  // Host styles unchanged after the widget mounted.
  expect(
    await hostButton.evaluate(
      (el) => getComputedStyle(el).borderRadius + '|' + getComputedStyle(el).fontFamily,
    ),
  ).toBe(before);
  await page.screenshot({ path: '../../docs/screenshots/embedded-widget.png' });
});
