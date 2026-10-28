// @ts-check
/**
 * `npm run e2e:add` (and the second half of `npm run e2e`): the add and
 * edit flow's own browser run (`e2e/add.spec.js`), on **its own** freshly
 * wiped database (`.e2e-add-db`) and port.
 *
 * It is separate from playwright.config.js because these tests write: they
 * archive fixtures, and the read-only specs pin counts and states that come
 * from the example seed alone (`e2e/search.spec.js`'s "7 translations" for
 * `everyone`, `e2e/me.spec.js`'s empty "added by me" list). One added item
 * would flip both, and the projects run in parallel, so there is no safe
 * moment to clean up inside a shared run. Rather than tag tests or order
 * projects, the writes get a database of their own.
 *
 * Ordering matters only in that the two configs never run at once: each
 * config's `webServer` takes `.e2e-build.lock` and builds into this
 * checkout (scripts/e2eLock.js), so `npm run e2e` runs them one after the
 * other.
 */
import { defineConfig } from '@playwright/test';
import { PROJECTS, devServer } from './e2e/helpers.js';

const PORT = Number(process.env.E2E_ADD_PORT ?? 4312);

export default defineConfig({
  testDir: './e2e',
  testMatch: 'add.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  globalTeardown: './e2e/restoreBuild.js',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: devServer({ port: PORT, dbDir: '.e2e-add-db', siteDir: 'examples/solluna', ingestFixtures: 'test/fixtures/tweets' }),
  projects: PROJECTS,
});
