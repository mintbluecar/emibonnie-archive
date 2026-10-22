// @ts-check
/**
 * Plan 1b Task 7 brief: browser smoke tests and accessibility checks.
 * `npm run e2e` starts `npm run seed-dev && npm run dev` (the same
 * rewrites production uses, per the brief) against a dedicated, disposable
 * PGlite directory, then runs test/e2e/smoke.spec.js twice -- once per
 * `projects` entry below -- at the brief's two widths, 390x844 (phone)
 * and 1280x800 (desktop). Chromium only: `npx playwright install chromium`
 * locally, `npx playwright install --with-deps chromium` in CI.
 */
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4310);

export default defineConfig({
  testDir: './test/e2e',
  globalSetup: './test/e2e/globalSetup.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run seed-dev && npm run dev',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PORT: String(PORT), PGLITE_DIR: '.e2e-db' },
  },
  projects: [
    { name: 'phone', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
  ],
});
