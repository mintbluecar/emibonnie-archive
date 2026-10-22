// @ts-check
/**
 * Plan 1b Task 7 brief (review round 2): Playwright smoke + axe checks
 * of the engine against the dev server, which playwright.config.js's
 * `webServer` starts with `npm run seed-dev && npm run dev` -- the same
 * rewrites and security headers production uses (scripts/dev.js, review
 * round 2, C2) -- against a freshly wiped PGlite directory (review round
 * 2, I2), always on the fictional solluna example, whatever the repo's
 * own `site/` holds (Task 9a item 1: `SITE_DIR=examples/solluna`; a
 * site's own pages are `npm run e2e:site`'s, `e2e/site.spec.js`).
 * `npm run seed-dev` reports "seeded 9"; ids and names below come from
 * test/fixtures/tweets/build.mjs's `IDS` and
 * examples/solluna/seed/maps.json. Run with `npm run e2e` (Chromium
 * only -- `npx playwright install chromium` locally, `npx playwright
 * install --with-deps chromium` in CI). `playwright.config.js`'s four
 * `projects` run the per-page checks (the `PAGES` loop below, plus the
 * unknown-path 404 test) at the brief's two widths in both light and
 * dark mode; the item-page-specific extra checks only run in light
 * mode (`DARK_PROJECTS` guard, review round 2, I1).
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
 * Every other test routes the media hosts to tiny synthetic fixtures
 * (`stubSyntheticMedia`, e2e/helpers.js, which also holds the per-page
 * checks both specs share).
 */
import { test, expect } from '@playwright/test';
import { checkPage, gotoReady, stubSyntheticMedia, DARK_PROJECTS } from './helpers.js';

const IDS = {
  LONG: '1900000000000000001',
  LIVE: '1900000000000000004',
  JOINT_LIVE: '1900000000000000007',
  POST: '1900000000000000008',
  PHOTO: '1900000000000000009',
};
const EVENT_SLUG = 'solluna-at-starfest-2026-10-18';
const SEARCH_Q = encodeURIComponent('ครบ');
/** 40% of the phone viewport's 844px height, matching src/styles/components/videoPlayer.css's `max-height: 40svh`. */
const LIVE_HEIGHT_CAP = 338;

const PAGES = [
  ['home', '/'],
  ['event', `/e/${EVENT_SLUG}`],
  ['item (LONG)', `/t/${IDS.LONG}`],
  ['item (JOINT_LIVE, has a joint speaker bubble -- review round 1, M3)', `/t/${IDS.JOINT_LIVE}`],
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

test('LONG: the sticky media area stays at top:0 after scrolling 2000px, the 🐱 line shows 🌙 luna, and the stub clip decodes', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'item-page extras only run in light mode (I1)');
  await stubSyntheticMedia(page);
  await gotoReady(page, `/t/${IDS.LONG}`);
  const media = page.locator('.c-item__media');
  await expect(media).toHaveCSS('position', 'sticky');
  await expect(media).toHaveCSS('top', '0px');
  // A sticky element's containing block is its own grid area (.c-item, which
  // `.c-item__media` spans both rows of) -- it can only stay stuck while that
  // area is still scrolling past, not once the page scrolls into
  // `.c-item__footer` below the grid (a few hundred px here). Scrolling by a
  // literal 2000px can overshoot into the footer on a page this long, so the
  // target is capped at the grid's own bottom (minus the viewport height) --
  // still "scroll a lot and check it's still stuck", just never further than
  // where sticky can legitimately hold.
  const scrollTarget = await page.evaluate(() => {
    const rect = document.querySelector('.c-item').getBoundingClientRect();
    const gridBottomInPage = rect.bottom + window.scrollY;
    return Math.max(0, Math.min(2000, gridBottomInPage - window.innerHeight - 20));
  });
  await page.evaluate((y) => window.scrollTo(0, y), scrollTarget);
  await expect.poll(() => media.evaluate((el) => Math.abs(el.getBoundingClientRect().top))).toBeLessThanOrEqual(1);

  const lunaBubble = await page.locator('.c-bubbles__msg').evaluateAll((msgs) => msgs.some((m) => (
    m.querySelector('.c-bubbles__avatar')?.textContent?.trim() === '🌙' && m.querySelector('.c-bubbles__name')?.textContent?.trim() === 'luna'
  )));
  expect(lunaBubble).toBe(true);

  // Review round 2, C3: the stub clip must actually decode, not just avoid a 404.
  await expect.poll(() => page.locator('.c-video__el').evaluate((el) => /** @type {HTMLVideoElement} */ (el).readyState)).toBeGreaterThanOrEqual(1);
  await expect(page.locator('.c-video__gone')).toHaveCount(0);
});

test('PHOTO: shows 2 images in the capped area; tapping opens the zoom dialog, Escape closes it', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'item-page extras only run in light mode (I1)');
  await stubSyntheticMedia(page);
  await gotoReady(page, `/t/${IDS.PHOTO}`);
  const slides = page.locator('.c-carousel__slide');
  await expect(slides).toHaveCount(2);

  await slides.first().click();
  const dialog = page.locator('.c-zoom');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('POST: the quote card appears above the translation', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'item-page extras only run in light mode (I1)');
  await stubSyntheticMedia(page);
  await gotoReady(page, `/t/${IDS.POST}`);
  const quoteBox = await page.locator('.c-quote').boundingBox();
  const bubblesBox = await page.locator('.c-bubbles').first().boundingBox();
  expect(quoteBox).toBeTruthy();
  expect(bubblesBox).toBeTruthy();
  expect(/** @type {{y: number}} */ (quoteBox).y).toBeLessThan(/** @type {{y: number}} */ (bubblesBox).y);
});

test('LIVE (vertical clip) at phone width: the media box is capped at 40% of viewport height, first bubble visible without scrolling, and the stub clip decodes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'the 40%-of-viewport cap is only meaningful at the phone, light-mode project');
  await stubSyntheticMedia(page);
  await gotoReady(page, `/t/${IDS.LIVE}`);
  const video = page.locator('.c-video');
  await expect(video).toBeVisible();
  const box = await video.boundingBox();
  expect(/** @type {{height: number}} */ (box).height).toBeLessThanOrEqual(LIVE_HEIGHT_CAP);

  const firstBubbleTop = await page.locator('.c-bubbles__msg, .c-bubbles__plain, .c-bubbles__crowd').first().evaluate((el) => el.getBoundingClientRect().top);
  expect(firstBubbleTop).toBeLessThan(testInfo.project.use.viewport?.height ?? 844);

  // Review round 2, C3: the stub clip must actually decode, not just avoid a 404.
  await expect.poll(() => page.locator('.c-video__el').evaluate((el) => /** @type {HTMLVideoElement} */ (el).readyState)).toBeGreaterThanOrEqual(1);
  await expect(page.locator('.c-video__gone')).toHaveCount(0);
});

test('search: opening the filter sheet and pressing Escape returns focus to the filter icon', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'item-page extras only run in light mode (I1)');
  await checkPage(page, `/search?q=${SEARCH_Q}`);
  const filterBtn = page.locator('.c-header__filter-btn');
  await filterBtn.click();
  const dialog = page.locator('.c-filter-sheet');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(filterBtn).toBeFocused();
});

test('LONG real playback (requires E2E_REAL_VIDEO_URL -- see this file\'s header)', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'item-page extras only run in light mode (I1)');
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

  await gotoReady(page, `/t/${IDS.LONG}`);
  // Review round 2, M1: fail clearly on a 403 instead of only as an opaque readyState timeout.
  await expect.poll(
    () => page.evaluate(() => document.querySelector('.c-video__el')?.readyState ?? 0),
    { message: () => `readyState poll: forbidden (403) responses from video.twimg.com so far: ${JSON.stringify(forbidden)}` },
  ).toBeGreaterThanOrEqual(2);
  expect(forbidden).toEqual([]);
});

test('header (Task 9b): desktop is one top bar with no search box (the search page keeps its box); a phone keeps the box and the bottom tab bar', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'layout, not colour: light projects only');
  const desktop = testInfo.project.name === 'desktop';
  await gotoReady(page, '/');
  const bar = page.locator('.c-header__bar');
  await expect(bar.locator('.c-tabbar')).toHaveCount(1);
  await expect(page.locator('.c-header__search-box')).toBeVisible({ visible: !desktop });
  await expect(page.locator('.c-tabbar')).toHaveCSS('position', desktop ? 'static' : 'fixed');
  if (desktop) {
    const [wordmark, nav, column] = await Promise.all(['.c-header__wordmark', '.c-tabbar', 'main.container'].map((s) => page.locator(s).boundingBox()));
    const b = /** @type {{x: number, y: number, width: number, height: number}[]} */ ([wordmark, nav, column]);
    expect(Math.abs(b[0].y + b[0].height / 2 - (b[1].y + b[1].height / 2))).toBeLessThan(8);
    expect(b[0].x).toBeGreaterThanOrEqual(b[2].x);
    expect(b[1].x + b[1].width).toBeLessThanOrEqual(b[2].x + b[2].width + 1);
  }
  await gotoReady(page, `/search?q=${SEARCH_Q}`);
  await expect(page.locator('.c-header__search-box')).toBeVisible();
});
