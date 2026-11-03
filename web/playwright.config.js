// End-to-end tests (npm run e2e). Playwright starts the stack itself:
// e2e/server.cjs (real API + worker on a throwaway local Postgres, Fyers
// stubbed) and Vite, which proxies /api to it. Needs a local Postgres server;
// E2E_DATABASE_URL overrides the default postgres://localhost/postgres.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'light', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'light' }, metadata: { theme: 'light' } },
    { name: 'dark', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' }, metadata: { theme: 'dark' } },
  ],
  webServer: [
    {
      command: 'node e2e/server.cjs',
      url: 'http://127.0.0.1:4000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    },
    {
      command: 'npx vite --port 5173 --strictPort --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
