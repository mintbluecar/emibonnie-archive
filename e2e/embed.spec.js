// @ts-check
/**
 * Task 10b: the item page's original post as X's embed (`embedSources`).
 *
 * Runs in `npm run e2e` (playwright.config.js), against the same dev
 * server and bundled example as `smoke.spec.js` -- where the setting is
 * off. "Off" is checked as served. "On" is the same server with the two
 * things the setting changes for a browser swapped in by `page.route`:
 * the public settings (`/site/site.js`, which esbuild inlines into every
 * page bundle under `/build/` -- flipped there to `embedSources: true`) and
 * the page's CSP header (the engine's own `contentSecurityPolicy({
 * embedSources: true })`, exactly what `npm run build` writes to
 * vercel.json for such a site). The API and everything else are
 * untouched -- the setting changes nothing server-side -- and a second
 * build of another site into this same checkout (which every e2e server
 * builds into) is avoided.
 *
 * X itself is **blocked** (`platform.twitter.com` aborted), so CI never
 * depends on X: what's checked is our fallback -- the archived text,
 * author and link -- plus that widgets.js was asked for exactly once and
 * that our own code logs no console or CSP errors. Real loading of the
 * embed is checked by hand on a deployed preview.
 */
import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { contentSecurityPolicy } from '../scripts/buildOutputs.js';
import { gotoReady, stubSyntheticMedia, DARK_PROJECTS } from './helpers.js';

const LIVE = '1900000000000000004';
const X_HOST = 'https://platform.twitter.com';

/**
 * Console errors, page errors and CSP violations -- except the one
 * console line Chromium logs for X's own blocked script, which is the
 * point of the test, not our code.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
async function trackOwnErrors(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.location().url.startsWith(X_HOST)) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.exposeFunction('__onCspViolation', (/** @type {string} */ detail) => errors.push(`securitypolicyviolation: ${detail}`));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      // @ts-expect-error -- exposed above, not declared on window
      window.__onCspViolation(`${e.violatedDirective} blocked ${e.blockedURI}`);
    });
  });
  return errors;
}

/**
 * Blocks X and counts what was asked of it.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>} the X URLs requested
 */
async function blockX(page) {
  /** @type {string[]} */
  const asked = [];
  await page.route(`${X_HOST}/**`, (route) => { asked.push(route.request().url()); return route.abort('blockedbyclient'); });
  return asked;
}

/** How a minified page bundle spells the example's `embedSources: false` (esbuild inlines `/site/site.js` into each one). */
const SETTING_OFF = /embedSources:(?:!1|false)\b/g;

/**
 * Serves this page as a site with `embedSources: true` would be served:
 * its page bundles with the setting flipped, and its document with that
 * site's CSP.
 * @param {import('@playwright/test').Page} page
 * @param {string} path the page whose response gets that site's CSP
 * @returns {Promise<{ flipped: number }>} how many bundles had the setting flipped
 */
async function turnEmbedSourcesOn(page, path) {
  const state = { flipped: 0 };
  await page.route('**/build/*.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.match(SETTING_OFF)) state.flipped += 1;
    await route.fulfill({ response, body: body.replace(SETTING_OFF, 'embedSources:!0') });
  });
  await page.route(`**${path}`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': contentSecurityPolicy({ embedSources: true }) } });
  });
  return state;
}

/** @param {import('@playwright/test').Page} page @returns {Promise<void>} */
async function assertNoSeriousA11yViolations(page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious, JSON.stringify(serious.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), null, 2)).toEqual([]);
}

test('embedSources off (the example site, as served): one "original tweet" link, no embed, nothing asked of X', async ({ page }) => {
  await stubSyntheticMedia(page);
  const asked = await blockX(page);
  const errors = await trackOwnErrors(page);
  await gotoReady(page, `/t/${LIVE}`);
  await expect(page.locator('.c-item__footer a[href^="https://x.com/"]')).toHaveCount(1);
  await expect(page.locator('.c-item__footer a[href^="https://x.com/"]')).toHaveText('original tweet');
  await expect(page.locator('blockquote.twitter-tweet')).toHaveCount(0);
  await expect(page.locator('[data-action="copy-link"]')).toBeVisible();
  expect(asked).toEqual([]);
  expect(errors).toEqual([]);
});

test('embedSources on, X blocked: the blockquote fallback shows our text, author and canonical link; widgets.js asked for once; no console or CSP errors from our code', async ({ page }, testInfo) => {
  await stubSyntheticMedia(page);
  const asked = await blockX(page);
  const errors = await trackOwnErrors(page);
  const on = await turnEmbedSourcesOn(page, `/t/${LIVE}`);
  const item = await (await page.request.get(`/api/item/translation/${LIVE}`)).json();
  await gotoReady(page, `/t/${LIVE}`);
  expect(on.flipped, 'the page bundle carried the setting').toBeGreaterThan(0);

  const quote = page.locator('.c-item__footer blockquote.twitter-tweet');
  await expect(quote).toBeVisible();
  await expect(quote).toHaveAttribute('data-dnt', 'true');
  if (DARK_PROJECTS.includes(testInfo.project.name)) await expect(quote).toHaveAttribute('data-theme', 'dark');
  else await expect(quote).not.toHaveAttribute('data-theme');
  await expect(quote.locator('.c-embed__text')).toContainText(item.original.split('\n')[0]);
  await expect(quote.locator('.c-embed__by')).toContainText(`(@${item.credits.account.handle})`);
  const primary = item.sources.find((/** @type {any} */ s) => s.role === 'primary');
  expect(primary.url).toMatch(/^https:\/\/x\.com\/\w+\/status\/\d+$/);
  await expect(quote.locator('a.c-embed__link')).toHaveAttribute('href', primary.url);
  await expect(page.locator('.c-item__footer > a.c-item__footer-link[href^="https://x.com/"]')).toHaveCount(0);
  await expect(page.locator('[data-action="copy-link"]')).toBeVisible();
  await expect(page.locator('.c-item__footer [data-action="report"]')).toBeVisible();

  await expect.poll(() => asked.length).toBe(1);
  expect(asked[0]).toBe(`${X_HOST}/widgets.js`);
  await expect(page.locator('script#twitter-wjs')).toHaveCount(1);
  await expect(page.locator('meta[name="twitter:widgets:csp"][content="on"]')).toHaveCount(1);
  await assertNoSeriousA11yViolations(page);
  expect(errors).toEqual([]);
});

test('embedSources on: the privacy page shows the X embed notice, linking X\'s privacy policy; off, it doesn\'t', async ({ page }) => {
  await gotoReady(page, '/privacy');
  await expect(page.locator('[data-embed-notice]')).toHaveCount(0);
  const on = await turnEmbedSourcesOn(page, '/privacy');
  await gotoReady(page, '/privacy');
  expect(on.flipped).toBeGreaterThan(0);
  const notice = page.locator('[data-embed-notice]');
  await expect(notice).toBeVisible();
  await expect(notice.locator('a')).toHaveAttribute('href', 'https://x.com/en/privacy');
  await assertNoSeriousA11yViolations(page);
});

test('embedSources on, X blocked (Task 10c l, q; 10d extra): the embed\'s attributes, its width (the column up to 550px, centred), an "original tweet" heading, and a crop that only a tall post gets -- the switch opens it, toggling aria-expanded, keyboard reachable', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'layout, not colour: light projects only');
  await stubSyntheticMedia(page);
  await blockX(page);
  await turnEmbedSourcesOn(page, `/t/${LIVE}`);
  await gotoReady(page, `/t/${LIVE}`);
  const quote = page.locator('blockquote.twitter-tweet');
  await expect(quote).toHaveAttribute('data-cards', 'hidden');
  await expect(quote).toHaveAttribute('data-conversation', 'none');
  // Task 10d extra: no data-width -- X's embed fills its container up to 550px (docs.x.com embedded-posts FAQ).
  await expect(quote).not.toHaveAttribute('data-width', /.*/);
  await expect(page.locator('.c-embed-box h2.c-embed-box__label')).toHaveText('original tweet');
  const box = page.locator('.c-embed-box');
  const more = page.locator('.c-embed-box__more');
  // Task 10d extra: the column's width up to 550px, centred in the column (the box's parent's content box).
  const m = await box.evaluate((el) => {
    const parent = /** @type {HTMLElement} */ (el.parentElement);
    const cs = getComputedStyle(parent);
    const p = parent.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { width: r.width, left: r.left, right: r.right, colLeft: p.left + parseFloat(cs.paddingLeft), colRight: p.right - parseFloat(cs.paddingRight) };
  });
  const column = m.colRight - m.colLeft;
  if (testInfo.project.name === 'phone') {
    expect(Math.abs(m.width - column), `fills the ${column}px column`).toBeLessThanOrEqual(1);
  } else {
    expect(Math.abs(m.width - 550), `550px wide in a ${column}px column`).toBeLessThanOrEqual(1);
    expect(Math.abs((m.left - m.colLeft) - (m.colRight - m.right)), 'centred in the column').toBeLessThanOrEqual(1);
  }
  await expect(more).toBeHidden(); // a short post: no switch, no crop
  // A synthetic long post: more text in the fallback than the cap holds.
  await quote.locator('.c-embed__text').evaluate((el) => { el.append('\nline of a very long translated post'.repeat(40)); });
  await expect(more).toBeVisible();
  await expect(box).toHaveClass(/c-embed-box--tall/);
  const clip = page.locator('.c-embed-box__clip');
  expect(await clip.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(321);
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(more).toHaveAttribute('aria-label', 'show full tweet');
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(more).toHaveAttribute('aria-label', 'show less');
  await expect(more).toBeFocused();
  expect(await clip.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(400);
  await page.keyboard.press('Enter');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  expect(await clip.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(321);
});
