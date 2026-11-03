import { expect, test } from './fixtures.js';

test('a wrong password is refused, the right one opens the Journal', async ({ page, shot }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByPlaceholder('Enter your password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await shot('login-error');

  await page.getByPlaceholder('Enter your password').fill('e2e-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Journal' })).toBeVisible();
});
