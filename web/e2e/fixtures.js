// Shared E2E fixtures. Each test runs twice, once per project (light, dark):
// the app reads its theme from localStorage, so it is set before any page
// script runs. `signIn()` goes through the real login form; `shot(name)` saves
// a full-page screenshot to e2e/screenshots/<theme>/<name>.png for review.
import { test as base, expect } from '@playwright/test';

export const PASSWORD = 'e2e-password'; // e2e/server.cjs

export const test = base.extend({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures must destructure their first argument.
  theme: [async ({}, use, info) => use(info.project.metadata.theme ?? 'light'), { option: false }],

  page: async ({ page, theme }, use) => {
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('orb.theme', t);
      } catch {}
    }, theme);
    await use(page);
  },

  signIn: async ({ page }, use) => {
    await use(async () => {
      await page.goto('/login');
      await page.getByPlaceholder('Enter your password').fill(PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('heading', { name: 'Journal' })).toBeVisible();
    });
  },

  shot: async ({ page, theme }, use) => {
    await use(async (name) => {
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: `e2e/screenshots/${theme}/${name}.png`, fullPage: true });
    });
  },
});

export { expect };
