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
 *
 * `stubSyntheticMedia`, `gotoReady`, `devServer` and `e2eLockToken` live in
 * scripts/devServerHelpers.js, not here: scripts/screens.js (the screen
 * gallery, Styling system Task 7) reuses them too, and it is a plain
 * script, not a Playwright test -- it must not pull `@playwright/test`
 * (this file's own `expect` import) in just to get them. Re-exported here
 * so every existing import of them from this file keeps working.
 */
import { expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { stubSyntheticMedia, gotoReady, devServer, e2eLockToken } from '../scripts/devServerHelpers.js';

export { stubSyntheticMedia, gotoReady, devServer, e2eLockToken };

/** Review round 2, I1: dark-mode projects only run the per-page checks, not the engine smoke's extras. */
export const DARK_PROJECTS = ['phone-dark', 'desktop-dark'];

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
 * `DEV_SIGN_IN=1` (this file's re-exported `devServer`); it is a 404 in production.
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
