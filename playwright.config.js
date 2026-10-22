// @ts-check
/**
 * Plan 1b Task 7 brief (review round 2): browser smoke tests and
 * accessibility checks. `npm run e2e` wipes `.e2e-db`, then starts
 * `npm run seed-dev && npm run dev` (the same rewrites production uses)
 * against that fresh, disposable PGlite directory, then runs
 * `e2e/smoke.spec.js` once per `projects` entry below: the brief's two
 * widths (390x844 phone, 1280x800 desktop) in light mode, and the same
 * two widths in dark mode (review round 2, I1). Chromium only: `npx
 * playwright install chromium` locally, `npx playwright install
 * --with-deps chromium` in CI.
 *
 * `DATABASE_URL`/`VERCEL` are forced empty in `webServer.env` (review
 * round 2, I2) so the dev server this starts can never pick up a real
 * database from the shell environment and fall through to it instead of
 * the fresh PGlite directory just wiped below.
 */
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4310);
const WIPE_E2E_DB = "node -e \"require('node:fs').rmSync('.e2e-db', { recursive: true, force: true })\"";

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `${WIPE_E2E_DB} && npm run seed-dev && npm run dev`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { PORT: String(PORT), PGLITE_DIR: '.e2e-db', DATABASE_URL: '', VERCEL: '' },
  },
  projects: [
    { name: 'phone', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, colorScheme: 'light' } },
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 }, colorScheme: 'light' } },
    { name: 'phone-dark', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, colorScheme: 'dark' } },
    { name: 'desktop-dark', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 }, colorScheme: 'dark' } },
  ],
});
