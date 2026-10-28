// @ts-check
/**
 * The per-page checks both browser specs share (Task 9a item 1):
 * `e2e/smoke.spec.js` (the engine, on the bundled example) and
 * `e2e/site.spec.js` (a site's own pages, URLs discovered from its API).
 *
 * Every page gets the brief's four checks (`checkPage`): a 200 (or the
 * expected status), no console/page/CSP errors, no horizontal scroll, and
 * no serious/critical axe violations -- after `#app[data-ready]`, which
 * every page's first paint sets (`public/js/core/dom.js`'s `mountPage()`),
 * success, 404 or load-error alike (review round 2, C1).
 *
 * Every page also routes `video.twimg.com`/`pbs.twimg.com` to
 * `e2e/fixtures/tiny-clip.webm`/`tiny.png` -- tiny, genuinely decodable,
 * synthetic media (never a real tweet's), committed to the repo (see the
 * fixtures' own README). The engine seed's clip URLs are invented and 404
 * for real, and a site's real ones would make the checks depend on X;
 * this keeps the `sourceGone` fallback from masking a check that has
 * nothing to do with playback (ruling 2).
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));
const TINY_VIDEO_PATH = path.join(FIXTURES_DIR, 'tiny-clip.webm');
const TINY_IMAGE_PATH = path.join(FIXTURES_DIR, 'tiny.png');

/** Review round 2, I1: dark-mode projects only run the per-page checks, not the engine smoke's extras. */
export const DARK_PROJECTS = ['phone-dark', 'desktop-dark'];

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function stubSyntheticMedia(page) {
  await page.route('https://video.twimg.com/**', (route) => route.fulfill({ status: 200, contentType: 'video/webm', path: TINY_VIDEO_PATH }));
  await page.route('https://pbs.twimg.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', path: TINY_IMAGE_PATH }));
}

/**
 * Collects console `error`s, uncaught page errors, and -- explicitly,
 * not just by scraping console text -- CSP violations (review round 2,
 * C2: scripts/dev.js sends the real CSP header, so a violation can
 * actually happen). `addInitScript` runs before any page script, so the
 * listener is in place for the very first navigation.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
export async function trackErrors(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.exposeFunction('__onCspViolation', (/** @type {string} */ detail) => errors.push(`securitypolicyviolation: ${detail}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      // @ts-expect-error -- exposed by trackErrors() above, not declared on window
      window.__onCspViolation(`${e.violatedDirective} blocked ${e.blockedURI}`);
    });
  });
  return errors;
}

/**
 * Navigates to `path` and waits for `#app[data-ready]` before anything
 * inspects the page.
 * @param {import('@playwright/test').Page} page @param {string} path
 * @returns {Promise<import('@playwright/test').Response|null>}
 */
export async function gotoReady(page, path) {
  const response = await page.goto(path);
  await page.waitForSelector('#app[data-ready]', { state: 'attached', timeout: 15_000 });
  return response;
}

/** @param {import('@playwright/test').Page} page @returns {Promise<void>} */
async function assertNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** @param {import('@playwright/test').Page} page @returns {Promise<void>} */
export async function assertNoSeriousA11yViolations(page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const details = serious.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) }));
  expect(serious, JSON.stringify(details, null, 2)).toEqual([]);
}

/**
 * A console error Chromium logs for the top-level navigation itself
 * returning a non-2xx status -- unavoidable on the 404 page, which by
 * definition really does answer 404 (ruling 3: an allowlist kept to an
 * exact message, with this comment, since routing it away via page.route
 * would mean no longer testing the real 404 response).
 */
const EXPECTED_404_NAVIGATION_ERROR = 'Failed to load resource: the server responded with a status of 404 (Not Found)';

/**
 * The four checks every page gets: a 200 (or `status`), no
 * console/page/CSP errors, no horizontal scroll, no serious/critical axe
 * violations.
 * @param {import('@playwright/test').Page} page @param {string} path @param {{ status?: number }} [options]
 * @returns {Promise<void>}
 */
export async function checkPage(page, path, { status = 200 } = {}) {
  await stubSyntheticMedia(page);
  const errors = await trackErrors(page);
  const response = await gotoReady(page, path);
  expect(response?.status(), path).toBe(status);
  await assertNoHorizontalScroll(page);
  await assertNoSeriousA11yViolations(page);
  expect(errors.filter((e) => !(status === 404 && e === EXPECTED_404_NAVIGATION_ERROR)), path).toEqual([]);
}

/**
 * Signs the page's browser context in as `as`, through a page on the
 * origin the app uses -- the me page's own signed-out screen, which loads
 * no media, so nothing from a richer page is still in flight when the
 * caller's checks start. The caller navigates next, so `checkPage` sees a
 * fresh load with the session already in place. `POST /api/auth/dev`
 * (src/routes/authDev.js) only exists when the dev server runs with
 * `DEV_SIGN_IN=1` (this file's `devServer`); it is a 404 in production.
 * @param {import('@playwright/test').Page} page
 * @param {'owner'|'member'|'google'|'translator'} as
 * @returns {Promise<void>}
 */
export async function signInAs(page, as) {
  await gotoReady(page, '/me');
  const status = await page.evaluate(async (who) => {
    const res = await fetch('/api/auth/dev', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ as: who }),
    });
    return res.status;
  }, as);
  expect(status, 'the dev-only sign-in route answered').toBe(200);
}

/** The four browser projects both specs run: the brief's two widths, light and dark (review round 2, I1). */
export const PROJECTS = [
  { name: 'phone', use: { browserName: /** @type {const} */ ('chromium'), viewport: { width: 390, height: 844 }, colorScheme: /** @type {const} */ ('light') } },
  { name: 'desktop', use: { browserName: /** @type {const} */ ('chromium'), viewport: { width: 1280, height: 800 }, colorScheme: /** @type {const} */ ('light') } },
  { name: 'phone-dark', use: { browserName: /** @type {const} */ ('chromium'), viewport: { width: 390, height: 844 }, colorScheme: /** @type {const} */ ('dark') } },
  { name: 'desktop-dark', use: { browserName: /** @type {const} */ ('chromium'), viewport: { width: 1280, height: 800 }, colorScheme: /** @type {const} */ ('dark') } },
];

/**
 * This Playwright run's `.e2e-build.lock` token (scripts/e2eLock.js):
 * set once in the CLI process when the config loads, and inherited by
 * everything it starts (the `webServer` command, the teardown). Its pid
 * part lets a later run tell a killed run's lock from a live one.
 * @returns {string}
 */
export function e2eLockToken() {
  process.env.E2E_LOCK_TOKEN ??= `${process.pid}:${randomUUID()}`;
  return process.env.E2E_LOCK_TOKEN;
}

/**
 * The dev server one spec runs against: takes the e2e build lock (fix
 * round 1, M7: both e2e suites build into this checkout), wipes `dbDir`, seeds `siteDir`'s
 * `seed/` into it (`npm run seed-dev`), then `npm run dev` (which builds
 * `siteDir` first) -- the same rewrites and security headers production
 * uses. `DATABASE_URL`/`VERCEL` are forced empty (review round 2, I2) so
 * it can never fall through to a real database from the shell.
 * `ingestFixtures` (the add-flow spec only): the API reads pasted links
 * from those synthetic fixtures instead of X, so the add flow is testable
 * offline (`INGEST_FIXTURES_DIR`, api/index.js). Playwright merges `env`
 * over `process.env`.
 * @param {{ port: number, dbDir: string, siteDir: string, ingestFixtures?: string }} options
 */
export function devServer({ port, dbDir, siteDir, ingestFixtures = '' }) {
  const wipe = `node -e "require('node:fs').rmSync('${dbDir}', { recursive: true, force: true })"`;
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
