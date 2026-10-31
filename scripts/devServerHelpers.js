// @ts-check
/**
 * Playwright pieces shared by e2e/helpers.js (the browser test suites) and
 * scripts/screens.js (the screen gallery, Styling system Task 7): media
 * stubbing, waiting for a page to be ready, and the dev server's
 * build+seed+serve command. None of this needs `@playwright/test`'s
 * `expect` (only e2e/helpers.js's own checks do) -- `screens.js` is a
 * plain script, not a Playwright test, so it must not pull
 * `@playwright/test` in just to reuse these. It lives in `scripts/`
 * (`jsconfig.json` type-checks `scripts/**`, not `e2e/**`) so importing it
 * from `screens.js` doesn't drag e2e/helpers.js's own, separately-checked
 * code into `npm run check`'s `tsc` pass.
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = fileURLToPath(new URL('../e2e/fixtures/', import.meta.url));
const TINY_VIDEO_PATH = path.join(FIXTURES_DIR, 'tiny-clip.webm');
const TINY_IMAGE_PATH = path.join(FIXTURES_DIR, 'tiny.png');

/**
 * Routes X's media hosts to tiny, genuinely decodable, synthetic fixtures
 * committed to the repo (e2e/fixtures/), so a page never depends on X.
 * @param {import('playwright').Page} page
 * @returns {Promise<void>}
 */
export async function stubSyntheticMedia(page) {
  await page.route('https://video.twimg.com/**', (route) => route.fulfill({ status: 200, contentType: 'video/webm', path: TINY_VIDEO_PATH }));
  await page.route('https://pbs.twimg.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', path: TINY_IMAGE_PATH }));
}

/**
 * Navigates to `path` and waits for `#app[data-ready]` before anything
 * inspects the page.
 * @param {import('playwright').Page} page @param {string} path
 * @returns {Promise<import('playwright').Response|null>}
 */
export async function gotoReady(page, path) {
  const response = await page.goto(path);
  await page.waitForSelector('#app[data-ready]', { state: 'attached', timeout: 15_000 });
  return response;
}

/**
 * This run's `.e2e-build.lock` token (scripts/e2eLock.js): set once in the
 * CLI process when it starts, and inherited by everything it starts (the
 * `webServer` command, the teardown, or -- for `screens.js` -- the server
 * it spawns and the release it calls itself). Its pid part lets a later
 * run tell a killed run's lock from a live one.
 * @returns {string}
 */
export function e2eLockToken() {
  process.env.E2E_LOCK_TOKEN ??= `${process.pid}:${randomUUID()}`;
  return process.env.E2E_LOCK_TOKEN;
}

/**
 * The dev server one caller runs against: takes the e2e build lock (both
 * `npm run e2e` and `npm run e2e:site` build into this checkout), wipes
 * `dbDir`, seeds `siteDir`'s `seed/` into it (`npm run seed-dev`), then
 * `npm run dev` (which builds `siteDir` first) -- the same rewrites and
 * security headers production uses. `DATABASE_URL`/`VERCEL` are forced
 * empty so it can never fall through to a real database from the shell.
 * `ingestFixtures`: the API reads pasted links from those synthetic
 * fixtures instead of X, so the add flow is testable offline
 * (`INGEST_FIXTURES_DIR`, api/index.js). The caller merges `env` over
 * `process.env` when it spawns `command`.
 * @param {{ port: number, dbDir: string, siteDir: string, ingestFixtures?: string }} options
 * @returns {{ command: string, url: string, reuseExistingServer: boolean, timeout: number, env: Record<string, string> }}
 */
export function devServer({ port, dbDir, siteDir, ingestFixtures = '' }) {
  const wipe = `node -e "require('node:fs').rmSync('${dbDir}', { recursive: true, force: true })"`;
  /** @type {Record<string, string>} */
  const env = { PORT: String(port), PGLITE_DIR: dbDir, SITE_DIR: siteDir, DATABASE_URL: '', VERCEL: '', DEV_SIGN_IN: '1', E2E_LOCK_TOKEN: e2eLockToken() };
  if (ingestFixtures) env.INGEST_FIXTURES_DIR = ingestFixtures;
  return {
    command: `node scripts/e2eLock.js && ${wipe} && npm run seed-dev && npm run dev`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env,
  };
}
