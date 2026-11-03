import { expect, test } from './fixtures.js';

test('Live lists seeded paper trades and charts the selected one', async ({ page, signIn, shot }) => {
  await signIn();
  await page.locator('nav').getByRole('link', { name: 'Live' }).click();
  await expect(page.getByRole('heading', { name: 'Live paper' })).toBeVisible();
  const main = page.locator('main');
  // LIVE_ENABLED is unset in e2e, so the page says the session is off.
  await expect(main.getByText('Live paper trading is off').first()).toBeVisible();
  await expect(main.getByText('Net P&L').first()).toBeVisible();
  await expect(main.getByText('SBIN').first()).toBeVisible();
  await expect(main.getByText('What happened')).toBeVisible();
  await expect(main.locator('canvas').first()).toBeVisible();
  await shot('live');
});
