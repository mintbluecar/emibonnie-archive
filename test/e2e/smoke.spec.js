// @ts-check
/**
 * Plan 1b Task 7 brief: Playwright smoke + axe checks against the dev
 * server, which playwright.config.js's `webServer` starts with the exact
 * command the brief names (`npm run seed-dev && npm run dev`) -- the same
 * rewrites production uses, seeded with the fictional solluna example
 * (`npm run seed-dev` reports "seeded 9"; ids and names below come from
 * test/fixtures/tweets/build.mjs's `IDS` and examples/solluna/seed/maps.json).
 * Run with `npm run e2e` (Chromium only -- `npx playwright install
 * chromium` locally, `npx playwright install --with-deps chromium` in CI).
 * `playwright.config.js`'s two `projects` run every test in this file
 * once at 390x844 (phone) and once at 1280x800 (desktop).
 *
 * Real playback (ruling 1): the solluna seed's clip URLs are synthetic
 * (invented `video.twimg.com` ids) and 404 for real -- a real tweet's
 * media must never be committed to this fandom-neutral engine repo. Set
 * the env var `E2E_REAL_VIDEO_URL` to a real `video.twimg.com` mp4 URL to
 * run the one test below that plays a clip end-to-end (`readyState >=
 * 2`, no 403 from `video.twimg.com`) -- unset, it's `test.skip`ped with a
 * reason. This repo's own CI never sets it; the private site repo runs
 * it with a real URL later (Task 9 of this plan).
 *
 * Every other test routes `video.twimg.com`/`pbs.twimg.com` to the tiny,
 * genuinely valid (not a real tweet's) media `test/e2e/globalSetup.js`
 * generates once per run, so the synthetic ids' real 404 -- and the
 * `sourceGone` fallback videoPlayer.js's `bind()` would otherwise show
 * after its own refetch also fails -- never masks a check that has
 * nothing to do with real playback (ruling 2).
 */
import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { TINY_IMAGE_PATH, TINY_VIDEO_PATH } from './globalSetup.js';

const IDS = {
  LONG: '1900000000000000001',
  LIVE: '1900000000000000004',
  POST: '1900000000000000008',
  PHOTO: '1900000000000000009',
};
const EVENT_SLUG = 'solluna-at-starfest-2026-10-18';
const SEARCH_Q = encodeURIComponent('ครบ');
/** 40% of the phone viewport's 844px height, matching src/styles/components/videoPlayer.css's `max-height: 40svh`. */
const LIVE_HEIGHT_CAP = 338;

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function stubSyntheticMedia(page) {
  await page.route('https://video.twimg.com/**', (route) => route.fulfill({ status: 200, contentType: 'video/webm', path: TINY_VIDEO_PATH }));
  await page.route('https://pbs.twimg.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', path: TINY_IMAGE_PATH }));
}

/**
 * Collects console `error`s (CSP violations included -- Chromium reports
 * those as console errors) and uncaught page errors from here on.
 * @param {import('@playwright/test').Page} page
 * @returns {string[]}
 */
function trackErrors(page) {
  /** @type {string[]} */
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

/** @param {import('@playwright/test').Page} page @returns {Promise<void>} */
async function assertNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** @param {import('@playwright/test').Page} page @returns {Promise<void>} */
async function assertNoSeriousA11yViolations(page) {
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
 * The brief's four checks every page gets: a 200 (or `status`), no
 * console/page errors, no horizontal scroll, no serious/critical axe
 * violations.
 * @param {import('@playwright/test').Page} page @param {string} path @param {{ status?: number }} [options]
 * @returns {Promise<void>}
 */
async function checkPage(page, path, { status = 200 } = {}) {
  await stubSyntheticMedia(page);
  const errors = trackErrors(page);
  const response = await page.goto(path);
  expect(response?.status()).toBe(status);
  await assertNoHorizontalScroll(page);
  await assertNoSeriousA11yViolations(page);
  expect(errors.filter((e) => !(status === 404 && e === EXPECTED_404_NAVIGATION_ERROR))).toEqual([]);
}

const PAGES = [
  ['home', '/'],
  ['event', `/e/${EVENT_SLUG}`],
  ['item (LONG)', `/t/${IDS.LONG}`],
  ['search', `/search?q=${SEARCH_Q}`],
  ['person', '/p/solsunny'],
  ['account', '/tl/tl_alpha'],
  ['about', '/about'],
  ['privacy', '/privacy'],
  ['takedown', '/takedown'],
];

for (const [name, path] of PAGES) {
  test(`${name}: 200, no console errors, no horizontal scroll, no serious a11y violations`, async ({ page }) => {
    await checkPage(page, path);
  });
}

test('an unknown path: 404 status, renders, no console errors', async ({ page }) => {
  await checkPage(page, '/this-page-does-not-exist', { status: 404 });
});

test('LONG: the sticky media area stays at top:0 after scrolling 2000px, and the 🐱 line shows 🌙 luna', async ({ page }) => {
  await stubSyntheticMedia(page);
  await page.goto(`/t/${IDS.LONG}`);
  const media = page.locator('.c-item__media');
  await expect(media).toHaveCSS('position', 'sticky');
  await expect(media).toHaveCSS('top', '0px');
  await page.evaluate(() => window.scrollBy(0, 2000));
  await expect.poll(() => media.evaluate((el) => Math.abs(el.getBoundingClientRect().top))).toBeLessThanOrEqual(1);

  const lunaBubble = await page.locator('.c-bubbles__msg').evaluateAll((msgs) => msgs.some((m) => (
    m.querySelector('.c-bubbles__avatar')?.textContent?.trim() === '🌙' && m.querySelector('.c-bubbles__name')?.textContent?.trim() === 'luna'
  )));
  expect(lunaBubble).toBe(true);
});

test('PHOTO: shows 2 images in the capped area; tapping opens the zoom dialog, Escape closes it', async ({ page }) => {
  await stubSyntheticMedia(page);
  await page.goto(`/t/${IDS.PHOTO}`);
  const slides = page.locator('.c-carousel__slide');
  await expect(slides).toHaveCount(2);

  await slides.first().click();
  const dialog = page.locator('.c-zoom');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('POST: the quote card appears above the translation', async ({ page }) => {
  await stubSyntheticMedia(page);
  await page.goto(`/t/${IDS.POST}`);
  const quoteBox = await page.locator('.c-quote').boundingBox();
  const bubblesBox = await page.locator('.c-bubbles').first().boundingBox();
  expect(quoteBox).toBeTruthy();
  expect(bubblesBox).toBeTruthy();
  expect(/** @type {{y: number}} */ (quoteBox).y).toBeLessThan(/** @type {{y: number}} */ (bubblesBox).y);
});

test('LIVE (vertical clip): the media box is capped at 40% of the phone viewport height, first bubble visible without scrolling', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'the 40%-of-viewport cap is only meaningful at the phone (390x844) project');
  await stubSyntheticMedia(page);
  await page.goto(`/t/${IDS.LIVE}`);
  const video = page.locator('.c-video');
  await expect(video).toBeVisible();
  const box = await video.boundingBox();
  expect(/** @type {{height: number}} */ (box).height).toBeLessThanOrEqual(LIVE_HEIGHT_CAP);

  const firstBubbleTop = await page.locator('.c-bubbles__msg, .c-bubbles__plain, .c-bubbles__crowd').first().evaluate((el) => el.getBoundingClientRect().top);
  expect(firstBubbleTop).toBeLessThan(testInfo.project.use.viewport?.height ?? 844);
});

test('search: opening the filter sheet and pressing Escape returns focus to the filter icon', async ({ page }) => {
  await checkPage(page, `/search?q=${SEARCH_Q}`);
  const filterBtn = page.locator('.c-header__filter-btn');
  await filterBtn.click();
  const dialog = page.locator('.c-filter-sheet');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(filterBtn).toBeFocused();
});

test('LONG real playback (requires E2E_REAL_VIDEO_URL -- see this file\'s header)', async ({ page }) => {
  const realUrl = process.env.E2E_REAL_VIDEO_URL;
  test.skip(!realUrl, 'set E2E_REAL_VIDEO_URL to a real video.twimg.com mp4 URL to run this check');

  /** @type {string[]} */
  const forbidden = [];
  page.on('response', (res) => {
    if (res.status() === 403 && new URL(res.url()).hostname === 'video.twimg.com') forbidden.push(res.url());
  });
  await page.route(`**/api/item/translation/${IDS.LONG}`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body?.media?.type === 'video') {
      body.media.variants = body.media.variants.map((/** @type {any} */ v) => ({ ...v, url: realUrl }));
    }
    await route.fulfill({ response, json: body });
  });

  await page.goto(`/t/${IDS.LONG}`);
  await page.waitForFunction(() => {
    const video = document.querySelector('.c-video__el');
    return video instanceof HTMLVideoElement && video.readyState >= 2;
  }, null, { timeout: 15_000 });
  const readyState = await page.locator('.c-video__el').evaluate((el) => /** @type {HTMLVideoElement} */ (el).readyState);
  expect(readyState).toBeGreaterThanOrEqual(2);
  expect(forbidden).toEqual([]);
});
