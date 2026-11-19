import { expect, test, type Page } from '@playwright/test';

async function join(page: Page, name: string) {
  await page.getByTestId('sign-in').click();
  await page.getByTestId('username-input').fill(name);
  await page.getByTestId('join-button').click();
  await expect(page.getByTestId('profile-link')).toContainText(name);
}

test('a visitor immediately sees Calmling living, with no onboarding', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('live-scene').locator('canvas')).toBeVisible();
  await expect(page.getByText('LIVE', { exact: true })).toBeVisible();
  await expect(page.getByTestId('day-number')).toContainText('Day');
  await expect(page.getByTestId('current-activity')).toContainText('Calmling is');
});

test('multiple browsers observe the same shared state', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await Promise.all([a.goto('/'), b.goto('/')]);
  await expect(a.getByTestId('day-number')).toBeVisible();
  await expect(b.getByTestId('day-number')).toBeVisible();
  // both tabs render the server-authoritative frame; allow for one tick of skew
  await expect
    .poll(async () => {
      const [da, db, aa, ab] = await Promise.all([a.getByTestId('day-number').textContent(), b.getByTestId('day-number').textContent(), a.getByTestId('current-activity').textContent(), b.getByTestId('current-activity').textContent()]);
      return da === db && aa === ab;
    }, { timeout: 15_000 })
    .toBe(true);
});

test('a viewer can send a flower and it appears in the world', async ({ page, request }) => {
  await page.goto('/');
  await join(page, `flower_fan_${Date.now() % 100000}`);
  await page.getByTestId('gift-grid').first().getByTestId('gift-flower').click();
  await page.getByTestId('send-gift').first().click();
  await expect(page.getByTestId('gift-status').first()).toContainText(/Your gift is in the world|noticed/, { timeout: 20_000 });
  await expect
    .poll(async () => {
      const world = await (await request.get('http://localhost:4000/api/world')).json();
      return world.objects.some((o: any) => o.kind === 'flower' && o.origin.type === 'gift');
    }, { timeout: 15_000 })
    .toBe(true);
  await page.goto('/profile');
  await expect(page.getByTestId('gift-facts').first()).toContainText('You gave Calmling a flower');
});

test('chat messages reach other viewers in real time', async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await Promise.all([a.goto('/'), b.goto('/')]);
  await join(a, `chatter_${Date.now() % 100000}`);
  const text = `hello from the test ${Date.now() % 1000}`;
  await a.getByTestId('chat-input').first().fill(text);
  await a.getByTestId('chat-input').first().press('Enter');
  await expect(b.getByTestId('chat-panel').first().getByText(text)).toBeVisible({ timeout: 10_000 });
});

test('admin can fast-forward and a diary entry is written from real events', async ({ page }) => {
  await page.goto('/admin');
  await page.getByTestId('admin-token').fill('e2e-admin');
  await page.getByTestId('admin-login').click();
  await page.getByTestId('ff-days').fill('1');
  await page.getByTestId('ff-run').click();
  await expect(page.getByTestId('admin-msg')).toContainText('Simulated 1 days', { timeout: 60_000 });
  await page.getByTestId('admin-pause').click();
  await expect(page.getByTestId('admin-resume')).toBeVisible();
  await page.getByTestId('admin-resume').click();
  await page.goto('/diary');
  await expect(page.getByTestId('diary-entry').first()).toBeVisible();
  await expect(page.getByTestId('diary-entry').first()).toContainText('verified events');
});
