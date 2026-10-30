// @ts-check
/**
 * `npm run e2e:site` (through `scripts/e2eSite.js`, which skips when
 * there's no `site/`): the same per-page browser checks as the engine
 * smoke, on **this repo's own** `site/` -- built, and its `seed/` loaded
 * into a freshly wiped `.e2e-site-db` -- across the same four projects
 * (Task 9a item 1). `e2e/site.spec.js` finds every URL it visits through
 * the site's API, so it fits any site's data.
 */
import { defineConfig } from '@playwright/test';
import { PROJECTS, devServer } from './e2e/helpers.js';
import { siteDirOf } from './scripts/cli.js';

const PORT = Number(process.env.E2E_SITE_PORT ?? 4311);

export default defineConfig({
  testDir: './e2e',
  testMatch: 'site.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  globalTeardown: './e2e/releaseLock.js',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: devServer({ port: PORT, dbDir: '.e2e-site-db', siteDir: siteDirOf(process.env) }),
  projects: PROJECTS,
});
