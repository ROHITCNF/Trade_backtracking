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

// Fixed / Trail (M10, #150). The stub seeds a trail row for each fixed entry
// (same entry and starting stop, no target) on the last three weekdays; the
// last day has three trail rows: SBIN, SBILIFE and ETERNAL.
test('Live toggles between the Fixed and Trail flows', async ({ page, signIn, shot }) => {
  await signIn();
  await page.locator('nav').getByRole('link', { name: 'Live' }).click();
  await expect(page.getByRole('heading', { name: 'Live paper' })).toBeVisible();
  const main = page.locator('main');
  const flow = page.getByRole('radiogroup', { name: 'Flow' });
  const trail = flow.getByRole('radio', { name: 'Trail' });

  // Defaults to Fixed, with no flow in the URL.
  await expect(flow.getByRole('radio', { name: 'Fixed' })).toHaveAttribute('aria-checked', 'true');
  await expect(page).not.toHaveURL(/flow=/);
  await expect(main.getByText('live only', { exact: true })).toHaveCount(0);

  // Trail: the URL, the list is refetched, and only trail rows show.
  const trailList = page.waitForResponse((r) => r.url().includes('/api/paper-trades?') && r.url().includes('flow=trail'));
  await trail.click();
  await trailList;
  await expect(page).toHaveURL(/flow=trail/);
  await expect(trail).toHaveAttribute('aria-checked', 'true');
  await expect(main.getByText('live only', { exact: true })).toHaveCount(2);
  await expect(main.getByText('Live only', { exact: true })).toBeVisible();
  await expect(main.getByText(/Not reconciled · live only/)).toBeVisible();
  await expect(main.getByText(/Same entry, Fixed:/)).toBeVisible();
  // The trail flow isn't reconciled, so the Review tab doesn't exist.
  await expect(main.getByRole('radio', { name: /^Review/ })).toHaveCount(0);
  await shot('live-trail');

  // Reload on the URL: the page opens on Trail.
  await page.goto('/live?flow=trail');
  await expect(page.getByRole('heading', { name: 'Live paper' })).toBeVisible();
  await expect(flow.getByRole('radio', { name: 'Trail' })).toHaveAttribute('aria-checked', 'true');
  await expect(main.getByText('Live only', { exact: true })).toBeVisible();

  // Back to Fixed: the Review tab returns and the trail tags go.
  await flow.getByRole('radio', { name: 'Fixed' }).click();
  await expect(page).not.toHaveURL(/flow=/);
  await expect(main.getByRole('radio', { name: /^Review/ })).toBeVisible();
  await expect(main.getByText('live only', { exact: true })).toHaveCount(0);
});

// The Trail flow at phone width: the toggle stays in the header, and a trail
// trade opens on its own screen with the other flow's result.
test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Live Trail trade opens on a phone with the Fixed result', async ({ page, signIn, shot }) => {
    await signIn();
    await page.goto('/live?flow=trail');
    const main = page.locator('main');
    await expect(page.getByRole('heading', { name: 'Live paper' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Flow' }).getByRole('radio', { name: 'Trail' })).toBeVisible();
    await expect(main.getByText('live only', { exact: true }).first()).toBeVisible();
    await main.getByRole('button', { name: /^SBIN/ }).first().click();
    await expect(main.getByText(/Same entry, Fixed:/)).toBeVisible();
    await shot('live-trail-phone');
  });
});

// Mail report (#157). The stub API's notifier sends nothing; it answers with
// the day's closed fixed-trade count.
test('Live mails the day report from the Mail report button', async ({ page, signIn, shot }) => {
  await signIn();
  await page.locator('nav').getByRole('link', { name: 'Live' }).click();
  await expect(page.getByRole('heading', { name: 'Live paper' })).toBeVisible();
  const button = page.getByRole('button', { name: 'Mail report' });
  await expect(button).toBeEnabled();
  const sent = page.waitForResponse((r) => /\/api\/paper-trades\/\d{4}-\d{2}-\d{2}\/mail$/.test(r.url()) && r.request().method() === 'POST');
  await button.click();
  expect((await sent).status()).toBe(200);
  await expect(page.getByRole('button', { name: /^Sent \d{4}-\d{2}-\d{2}$/ })).toBeVisible();
  await shot('live-mail-sent');
});
