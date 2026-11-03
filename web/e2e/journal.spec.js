import { expect, test } from './fixtures.js';

test('Journal shows each list over the last 20 trading days', async ({ page, signIn, shot }) => {
  await signIn();
  await expect(page.getByText('Last 20 trading days')).toBeVisible();
  // Seeded lists (e2e/server.cjs); the worker fills their day cells from stub candles.
  const main = page.locator('main');
  await expect(main.getByText('core', { exact: true }).first()).toBeVisible();
  await expect(main.getByText('final', { exact: true }).first()).toBeVisible();
  await expect(main.getByText('3 symbols').first()).toBeVisible();
  await expect(main.getByText(/[−+]₹[\d.,]+k?/).first()).toBeVisible({ timeout: 20_000 });
  await shot('journal');
});
