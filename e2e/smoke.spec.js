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
/** The pinned header bar's height (tokens.css `--sticky-top`, derived from `--tap-target` and `--header-pad-y`). */
const STICKY_TOP = { phone: 53, desktop: 61 };
/** The gap the item media keeps below the bar, before and while pinned (tokens.css `--item-media-gap`, Task 10c). */
const MEDIA_GAP = { phone: 8, desktop: 16 };

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

test('LONG: after scrolling 2000px the pinned header and the sticky media area are both in view, media --item-media-gap below the header (Task 10b, 10c), the 🐱 line shows 🌙 luna, and the stub clip decodes', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'item-page extras only run in light mode (I1)');
  await stubSyntheticMedia(page);
  await gotoReady(page, `/t/${IDS.LONG}`);
  const media = page.locator('.c-item__media');
  const header = page.locator('header.c-header');
  // Task 10b: the header is pinned at the top, and the media sticks at
  // --sticky-top -- the header bar's own height (53px phone, 61px desktop:
  // a 44px tap target, 4px/8px padding each side, a 1px border).
  const layout = testInfo.project.name === 'desktop' ? 'desktop' : 'phone';
  const stickyTop = `${STICKY_TOP[layout]}px`;
  expect(await page.locator('.c-header__bar').evaluate((el) => `${el.getBoundingClientRect().height}px`)).toBe(stickyTop);
  await expect(header).toHaveCSS('position', 'sticky');
  await expect(media).toHaveCSS('position', 'sticky');
  await expect(media).toHaveCSS('top', `${STICKY_TOP[layout] + MEDIA_GAP[layout]}px`);
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
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const headerBottom = parseFloat(stickyTop);
  await expect.poll(() => header.evaluate((el) => Math.abs(el.getBoundingClientRect().top))).toBeLessThanOrEqual(1);
  await expect.poll(() => header.evaluate((el) => el.getBoundingClientRect().bottom)).toBeCloseTo(headerBottom, 0);
  // Below the header, not under it, by the same gap it starts with (Task 10c).
  await expect.poll(() => media.evaluate((el) => el.getBoundingClientRect().top)).toBeCloseTo(headerBottom + MEDIA_GAP[layout], 0);
  await expect(header).toBeInViewport();
  await expect(media).toBeInViewport();

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

test('header (Task 9b; 10b fix O1): desktop is one top bar with no search box in it -- home keeps one at the top of its content column, the search page keeps its own, other pages have none; a phone keeps the box and the bottom tab bar', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'layout, not colour: light projects only');
  const desktop = testInfo.project.name === 'desktop';
  await gotoReady(page, '/');
  const bar = page.locator('.c-header__bar');
  await expect(bar.locator('.c-tabbar')).toHaveCount(1);
  await expect(page.locator('.c-header__search-box')).toBeVisible();
  await expect(bar.locator('.c-header__search-box')).toHaveCount(0);
  await expect(page.locator('.c-tabbar')).toHaveCSS('position', desktop ? 'static' : 'fixed');
  if (desktop) {
    const [wordmark, nav, column] = await Promise.all(['.c-header__wordmark', '.c-tabbar', 'main.container'].map((s) => page.locator(s).boundingBox()));
    const b = /** @type {{x: number, y: number, width: number, height: number}[]} */ ([wordmark, nav, column]);
    expect(Math.abs(b[0].y + b[0].height / 2 - (b[1].y + b[1].height / 2))).toBeLessThan(8);
    expect(b[0].x).toBeGreaterThanOrEqual(b[2].x);
    expect(b[1].x + b[1].width).toBeLessThanOrEqual(b[2].x + b[2].width + 1);
    // O1: home's box sits under the bar, lined up with the content column.
    const [box, barBox] = await Promise.all([page.locator('.c-header__search').boundingBox(), bar.boundingBox()]);
    const r = /** @type {{x: number, y: number, width: number, height: number}[]} */ ([box, barBox]);
    expect(r[0].y).toBeGreaterThanOrEqual(r[1].y + r[1].height);
    expect(r[0].x).toBeGreaterThanOrEqual(b[2].x);
    // Focus goes to the search page, as on a phone (headerLinks.js).
    await page.locator('.c-header__search-box').focus();
    await page.waitForURL('**/search');
  }
  await gotoReady(page, `/e/${EVENT_SLUG}`);
  await expect(page.locator('.c-header__search-box')).toBeVisible({ visible: !desktop });
  await gotoReady(page, `/search?q=${SEARCH_Q}`);
  await expect(page.locator('.c-header__search-box')).toBeVisible();
});

test('header (Task 10b): pinned on a long page -- after scrolling to the bottom of a person page, the header bar is still at the top; on a phone the search row has scrolled away under it, and keyboard focus is kept clear of it', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'layout, not colour: light projects only');
  const desktop = testInfo.project.name === 'desktop';
  await gotoReady(page, '/p/solsunny');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  const header = page.locator('header.c-header');
  await expect.poll(() => header.evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(0);
  await expect(header.locator('.c-header__wordmark')).toBeInViewport();
  await expect(page.locator('.c-header__find')).toBeVisible({ visible: !desktop });
  if (!desktop) {
    const searchTop = await page.locator('.c-header__search').evaluate((el) => el.getBoundingClientRect().top);
    expect(searchTop).toBeLessThan(STICKY_TOP.phone);
    // The phone bar's search icon goes to the search page.
    await expect(page.locator('.c-header__find')).toHaveAttribute('href', '/search');
  }
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingTop)).toBe(`${STICKY_TOP[desktop ? 'desktop' : 'phone']}px`);
  // M4: the bar's content always fits its fixed height (a theme that grows it must grow the tokens).
  expect(await page.locator('.c-header__bar').evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  // A landmark still (axe and screen readers find the banner).
  await expect(page.getByRole('banner')).toHaveCount(1);
});

test('header (Task 10b fix O2, M5): on a phone the search row never sits over the pinned bar -- at 0/300/1500px it is below the bar or fully gone, the bar is always on top while it scrolls away, and on the search page it stays pinned just below the bar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'the phone layout');
  await stubSyntheticMedia(page);
  const rowVsBar = () => page.evaluate(() => {
    const bar = /** @type {Element} */ (document.querySelector('.c-header__bar')).getBoundingClientRect();
    const row = /** @type {Element} */ (document.querySelector('.c-header__search')).getBoundingClientRect();
    // What's painted on top along the bar's bottom edge: the header, never the row.
    const onTop = [40, 195, 350].map((x) => document.elementFromPoint(x, bar.bottom - 2)?.closest('header.c-header') !== null);
    return { barBottom: bar.bottom, rowTop: row.top, rowBottom: row.bottom, scrollY: window.scrollY, barOnTop: onTop.every(Boolean) };
  });
  // The item page has no search row since Task 10c (r): e2e/polish.spec.js checks that.
  for (const path of ['/', `/e/${EVENT_SLUG}`, `/search?q=${SEARCH_Q}`]) {
    await gotoReady(page, path);
    for (const y of [0, 10, 20, 40, 60, 80, 120, 300, 1500]) {
      await page.evaluate((target) => window.scrollTo(0, target), y);
      const m = await rowVsBar();
      const where = `${path} at scrollY ${m.scrollY}`;
      expect(m.barOnTop, where).toBe(true);
      if ([0, 300, 1500].includes(y)) {
        const below = m.rowTop >= m.barBottom - 0.5;
        const gone = m.rowBottom <= m.barBottom + 0.5;
        expect(below || gone, `${where}: row ${m.rowTop}-${m.rowBottom}, bar bottom ${m.barBottom}`).toBe(true);
      }
      if (path.startsWith('/search')) expect(m.rowTop, `${where}: the live row stays pinned below the bar`).toBeGreaterThanOrEqual(m.barBottom - 0.5);
    }
  }
});

test.describe('search (Task 10b fix O3): touch devices', () => {
  test.use({ hasTouch: true });
  test('on a phone, the box is never focused on load -- arriving from a person chip, nor on the blank search page (no keyboard pops up)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'touch devices');
    for (const path of ['/search?people=1', '/search']) {
      await gotoReady(page, path);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches), 'touch emulated').toBe(true);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.activeElement?.classList.contains('c-header__search-box') ?? false), path).toBe(false);
    }
  });
});

test('search (Task 10b fix O3): with a mouse, only the blank search page focuses its box', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'fine pointer');
  await gotoReady(page, '/search');
  await expect(page.locator('.c-header__search-box')).toBeFocused();
  await gotoReady(page, '/search?people=1');
  await page.waitForTimeout(300);
  await expect(page.locator('.c-header__search-box')).not.toBeFocused();
});

for (const [label, path] of [['about', '/about'], ['privacy', '/privacy'], ['takedown', '/takedown']]) {
  test(`footer (Task 10b): clicking "${label}" reaches ${path} -- a 200 and its page, not "page not found"`, async ({ page }, testInfo) => {
    test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'links, not colour: light projects only');
    await gotoReady(page, '/');
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.request().isNavigationRequest()),
      page.locator('.c-footer__links a', { hasText: label }).click(),
    ]);
    expect(response.status(), response.url()).toBe(200);
    await page.waitForSelector('#app[data-ready]', { state: 'attached' });
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.locator('.c-static__title')).toBeVisible();
    await expect(page.locator('.c-empty-state')).toHaveCount(0);
  });
}

test('LONG (Task 10b): "show original" keeps the stored line breaks (white-space: pre-wrap)', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'layout, not colour: light projects only');
  await stubSyntheticMedia(page);
  await gotoReady(page, `/t/${IDS.LONG}`);
  await page.locator('.k-translation-detail__original-toggle').click();
  const text = page.locator('.k-translation-detail__original-text');
  await expect(text).toBeVisible();
  expect(await text.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe('pre-wrap');
  expect(await text.evaluate((el) => (el.textContent ?? '').includes('\n'))).toBe(true);
});

test('video (Task 9b): before play, the poster and a centred play button, no native controls; pressing play brings the controls', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'item-page extras only run in light mode (I1)');
  await stubSyntheticMedia(page);
  await gotoReady(page, `/t/${IDS.LONG}`);
  const video = page.locator('.c-video__el');
  await expect(video).toHaveAttribute('poster', /^https:\/\/pbs\.twimg\.com\//);
  expect(await video.evaluate((el) => /** @type {HTMLVideoElement} */ (el).controls)).toBe(false);
  const play = page.locator('.c-video__play');
  const [box, button] = await Promise.all([page.locator('.c-video').boundingBox(), play.boundingBox()]);
  const b = /** @type {{x: number, y: number, width: number, height: number}[]} */ ([box, button]);
  expect(Math.abs(b[0].x + b[0].width / 2 - (b[1].x + b[1].width / 2))).toBeLessThan(2);
  expect(Math.abs(b[0].y + b[0].height / 2 - (b[1].y + b[1].height / 2))).toBeLessThan(2);
  await play.click();
  await expect(play).toHaveCount(0);
  expect(await video.evaluate((el) => /** @type {HTMLVideoElement} */ (el).controls)).toBe(true);
  await expect(video).toBeFocused();
  await expect(page.locator('.c-video__full')).toBeVisible();
});
