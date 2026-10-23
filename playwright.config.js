// @ts-check
/**
 * `npm run e2e`: the engine's browser smoke tests and accessibility
 * checks (Plan 1b Task 7 brief, review round 2), `e2e/smoke.spec.js`
 * and `e2e/embed.spec.js` (Task 10b: the X embed, with X blocked), once
 * per project (e2e/helpers.js's `PROJECTS`: 390x844 phone and 1280x800
 * desktop, light and dark). Chromium only: `npx playwright
 * install chromium` locally, `npx playwright install --with-deps
 * chromium` in CI.
 *
 * The dev server always runs the **bundled example**
 * (`SITE_DIR=examples/solluna`) on its own freshly wiped `.e2e-db`,
 * whatever this repo's `site/` holds (Task 9a item 1), so it passes the
 * same in the engine and in any site repo. That build replaces the
 * checkout's build output with the example's, so `globalTeardown`
 * rebuilds the repo's own `site/` afterwards, when there is one.
 * A site's own pages are `npm run e2e:site` (`playwright.site.config.js`).
 */
import { defineConfig } from '@playwright/test';
import { PROJECTS, devServer } from './e2e/helpers.js';

const PORT = Number(process.env.E2E_PORT ?? 4310);

export default defineConfig({
  testDir: './e2e',
  testMatch: ['smoke.spec.js', 'embed.spec.js'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  globalTeardown: './e2e/restoreBuild.js',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: devServer({ port: PORT, dbDir: '.e2e-db', siteDir: 'examples/solluna' }),
  projects: PROJECTS,
});
