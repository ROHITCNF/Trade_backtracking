import { expect, test } from './fixtures.js';

test('Research runs a list, and a symbol opens its ticker page with a trade chart', async ({ page, signIn, shot }) => {
  await signIn();
  await page.locator('nav').getByRole('link', { name: 'Research' }).click();
  await page.getByRole('radio', { name: '1M' }).click();
  await page.getByRole('button', { name: 'Run research' }).click();

  await expect(page).toHaveURL(/research\?run=\d+/);
  const main = page.locator('main');
  await expect(main.getByText('Net P&L').first()).toBeVisible({ timeout: 30_000 });
  await expect(main.getByText('Profit factor').first()).toBeVisible();
  const symbols = main.locator('a[href*="/symbols/"]');
  await expect(symbols).toHaveCount(3);
  await shot('research-results');

  await symbols.filter({ hasText: 'SBIN' }).click();
  await expect(page.getByRole('heading', { name: 'SBIN', level: 1 })).toBeVisible();
  await expect(main.getByText('select one to see its chart')).toBeVisible();
  await main.locator('tbody tr').first().click();
  await expect(main.locator('canvas').first()).toBeVisible();
  await shot('ticker');
});
