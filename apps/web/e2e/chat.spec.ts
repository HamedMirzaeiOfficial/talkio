import { expect, test } from '@playwright/test';

import { login, openConversation, unique, userPage } from './helpers';

test('landing page links to sign in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Conversations that keep up/ })).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('development login with any phone number and code 1234', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('tab', { name: 'Phone number' })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Phone number').fill('09120001122');
  await page.getByLabel('Login code').fill('0000');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('demo code');
  await page.getByLabel('Login code').fill('1234');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app/);
});

test('rejects wrong credentials with a readable error', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('tab', { name: 'Username' }).click();
  await page.getByLabel('Username or email').fill('alice');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Incorrect username or password.');
});

test('registration creates an account and opens the workspace', async ({ page }) => {
  const handle = `e2e_${Date.now().toString(36)}`;
  await page.goto('/register');
  await page.getByLabel('Display name').fill('E2E Tester');
  await page.getByLabel('Username').fill(handle);
  await page.getByLabel('Password', { exact: true }).fill('Sturdy-pass-2026');
  await page.getByLabel('Confirm password').fill('Sturdy-pass-2026');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByText('No conversations yet')).toBeVisible();
});

test('messages are delivered in real time and update unread counts', async ({ browser }) => {
  const alice = await userPage(browser, 'alice');
  const bob = await userPage(browser, 'bahram');
  await openConversation(alice.page, 'Product design');

  const text = unique('Realtime check');
  const composer = alice.page.getByRole('textbox', { name: 'Write a message…' });
  await composer.fill(text);
  await composer.press('Enter');
  await expect(alice.page.getByRole('log').getByText(text)).toBeVisible();
  await expect(alice.page.getByRole('log').getByLabel('Sent').last()).toBeVisible();

  // Bob is not in the conversation: the list shows the preview and an unread badge.
  const row = bob.page
    .getByRole('navigation', { name: 'Conversations' })
    .getByRole('link', { name: /Product design/ });
  await expect(row).toContainText(text);
  await expect(row.getByLabel(/unread/)).toBeVisible();

  // Opening it clears the badge and shows the message.
  await row.click();
  await expect(bob.page.getByRole('log').getByText(text)).toBeVisible();
  await expect(row.getByLabel(/unread/)).toHaveCount(0);

  // Alice sees the read receipt.
  await expect(alice.page.getByRole('log').getByLabel('Read').last()).toBeVisible();
  await alice.context.close();
  await bob.context.close();
});

test('typing indicator is shown to other members', async ({ browser }) => {
  const alice = await userPage(browser, 'alice');
  const chen = await userPage(browser, 'chen');
  await openConversation(alice.page, 'Product design');
  await openConversation(chen.page, 'Product design');
  await chen.page.getByRole('textbox', { name: 'Write a message…' }).pressSequentially('Thinking about');
  await expect(alice.page.getByText('Chen is typing').first()).toBeVisible();
  await alice.context.close();
  await chen.context.close();
});

test('reply, react and edit through the message menu', async ({ page }) => {
  await login(page, 'alice');
  await openConversation(page, 'Engineering');
  const original = unique('Edit me');
  const composer = page.getByRole('textbox', { name: 'Write a message…' });
  await composer.fill(original);
  await composer.press('Enter');
  const bubble = page.locator('[data-message-id]').filter({ hasText: original }).last();
  await expect(bubble.getByLabel('Sent')).toBeVisible();

  // Edit with ArrowUp in the empty composer.
  await composer.press('ArrowUp');
  await expect(page.getByText('Editing message')).toBeVisible();
  await composer.fill(`${original} (edited text)`);
  await composer.press('Enter');
  await expect(
    page.locator('[data-message-id]').filter({ hasText: `${original} (edited text)` }),
  ).toContainText('edited');

  // React via the context menu.
  const edited = page.locator('[data-message-id]').filter({ hasText: `${original} (edited text)` });
  await edited.hover();
  await edited.getByRole('button', { name: 'Message actions' }).click();
  await page.getByRole('menuitem', { name: 'React 🔥' }).click();
  await expect(edited.getByRole('button', { name: '🔥 1' })).toHaveAttribute('aria-pressed', 'true');

  // Reply.
  await edited.hover();
  await edited.getByRole('button', { name: 'Message actions' }).click();
  await page.getByRole('menuitem', { name: 'Reply' }).click();
  await expect(page.getByText(/Replying to Alice/)).toBeVisible();
  await expect(composer).toBeFocused();
  const reply = unique('A reply');
  await composer.fill(reply);
  await composer.press('Enter');
  await expect(page.locator('[data-message-id]').filter({ hasText: reply })).toContainText(
    `${original} (edited text)`,
  );
});

test('keyboard: search with Ctrl+K and switch conversations with Alt+Arrow', async ({ page }) => {
  await login(page, 'alice');
  await page.keyboard.press('Control+k');
  const search = page.getByRole('searchbox', { name: 'Search messages' });
  await expect(search).toBeFocused();
  await search.fill('onboarding');
  await page
    .getByRole('button', { name: /onboarding flow/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/app\/c\//);
  const first = page.url();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page).not.toHaveURL(first);
});

test('goes offline, shows the banner, then recovers and catches up', async ({ browser }) => {
  const alice = await userPage(browser, 'alice');
  const elena = await userPage(browser, 'elena');
  await openConversation(alice.page, 'Engineering');
  await openConversation(elena.page, 'Engineering');

  await alice.context.setOffline(true);
  await expect(alice.page.getByRole('status').filter({ hasText: 'You are offline' })).toBeVisible();

  // A message sent while Alice is offline must appear after she reconnects (gap recovery).
  const missed = unique('Sent while you were away');
  const composer = elena.page.getByRole('textbox', { name: 'Write a message…' });
  await composer.fill(missed);
  await composer.press('Enter');
  await expect(
    elena.page
      .locator('[data-message-id]')
      .filter({ hasText: missed })
      .getByLabel(/Sent|Read/),
  ).toBeVisible();

  await alice.context.setOffline(false);
  await expect(alice.page.getByRole('status').filter({ hasText: /offline|Reconnecting/ })).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(alice.page.getByRole('log').getByText(missed)).toBeVisible();
  await alice.context.close();
  await elena.context.close();
});

test('group creation dialog creates a group', async ({ page }) => {
  await login(page, 'alice');
  await page.getByRole('button', { name: 'New group' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New group' });
  const name = unique('Launch crew');
  await dialog.getByLabel('Group name').fill(name);
  await dialog
    .getByRole('searchbox', { name: 'Search people' })
    .or(dialog.getByRole('textbox', { name: 'Search people' }))
    .fill('dana');
  await dialog.getByRole('option', { name: /Dana Okafor/ }).click();
  await dialog.getByRole('button', { name: 'Create group' }).click();
  await expect(page).toHaveURL(/\/app\/c\//);
  await expect(page.getByRole('log', { name: `Messages in ${name}` })).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(`${name} 2 members`) })).toBeVisible();
});
