// @ts-check
/**
 * Task 10d: search happens in place (spec, "Search happens in place").
 * Home is the search; the event, person and translator pages search
 * within themselves, with their own filter preset as a removable chip;
 * the old `/search` redirects home with its query. Same server and
 * example data as smoke.spec.js (examples/solluna, freshly seeded).
 * "everyone" matches 7 translations in the whole archive, 4 with sol
 * (`/p/solsunny`) and 1 at starfest, so a widened search shows more.
 */
import { test, expect } from '@playwright/test';
import { checkPage, gotoReady, DARK_PROJECTS } from './helpers.js';

const EVENT = '/e/solluna-at-starfest-2026-10-18';
const Q = 'everyone';
const LIGHT_ONLY = 'behaviour, not colour: light projects only (axe runs in every project below)';

/** The results line's text ("7 translations · best match first"). @param {import('@playwright/test').Page} page */
const countLine = (page) => page.locator('.c-search__count');

/**
 * Types `q` into the box, then waits for the debounced search's response.
 * @param {import('@playwright/test').Page} page @param {string} q
 */
async function typeQuery(page, q) {
  const box = page.locator('.c-header__search-box');
  const searched = page.waitForResponse((res) => res.url().includes('/api/search') && res.url().includes(`q=${q}`));
  await box.click();
  await box.fill(q);
  await searched;
}

for (const [name, path] of [['home, searching', `/?q=${Q}`], ['event, searching', `${EVENT}?q=${Q}`], ['person, scope removed', `/p/solsunny?q=${Q}&scope=all`], ['translator, searching', `/tl/tl_alpha?q=${Q}`]]) {
  test(`${name}: 200, no console errors, no horizontal scroll, no serious a11y violations (both themes)`, async ({ page }) => {
    await checkPage(page, path);
    await expect(page.locator('.c-search [data-result-card]').first()).toBeVisible();
  });
}

test('home: typing shows results in place, with no navigation; clearing the box brings the event list back', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), LIGHT_ONLY);
  await gotoReady(page, '/');
  /** @type {string[]} */
  const navigations = [];
  page.on('request', (req) => { if (req.isNavigationRequest()) navigations.push(req.url()); });
  const list = page.locator('[data-search-list]');
  await expect(list).toBeVisible();
  await expect(page.locator('.c-search')).toBeHidden();
  await typeQuery(page, Q);
  await expect(countLine(page)).toHaveText('7 translations · best match first');
  await expect(list).toBeHidden();
  expect(new URL(page.url()).search).toBe(`?q=${Q}`);
  await page.locator('.c-header__search-box').fill('');
  await expect(list).toBeVisible();
  await expect(page.locator('.c-search')).toBeHidden();
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe('/');
  expect(navigations, 'replaceState only, never a navigation').toEqual([]);
});

test('a URL with ?q= opens straight into its results, and a reload keeps them', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), LIGHT_ONLY);
  await gotoReady(page, `/?q=${Q}&people=1`);
  await expect(countLine(page)).toHaveText('4 translations · best match first');
  await expect(page.locator('.c-header__search-box')).toHaveValue(Q);
  await expect(page.locator('[data-action="remove-filter"]')).toHaveCount(1);
  await page.reload();
  await page.waitForSelector('#app[data-ready]', { state: 'attached' });
  await expect(countLine(page)).toHaveText('4 translations · best match first');
});

test('event page: the box searches within the event, preset as a removable chip; removing it widens to the whole archive, still on the page', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), LIGHT_ONLY);
  await gotoReady(page, EVENT);
  const box = page.locator('.c-header__search-box');
  await expect(box).toHaveAttribute('placeholder', 'search this event…');
  const chip = page.locator('[data-action="remove-filter"][data-field="event"]');
  await expect(chip).toBeVisible();
  await typeQuery(page, Q);
  await expect(countLine(page)).toHaveText('1 translation · best match first');
  await expect(page.locator('.c-event__head h1')).toBeVisible();
  await expect(page.locator('[data-event-sections]')).toBeHidden();
  expect(new URL(page.url()).pathname).toBe(EVENT);
  expect(new URL(page.url()).search).toBe(`?q=${Q}`);
  const widened = page.waitForResponse((res) => res.url().includes('/api/search') && !res.url().includes('eventSlug'));
  await chip.click();
  await widened;
  await expect(countLine(page)).toHaveText('7 translations · best match first');
  await expect(box).toHaveAttribute('placeholder', 'search what they said…');
  expect(new URL(page.url()).pathname).toBe(EVENT);
  await page.reload();
  await page.waitForSelector('#app[data-ready]', { state: 'attached' });
  await expect(countLine(page)).toHaveText('7 translations · best match first');
  await expect(chip).toHaveCount(0);
  // Fix round 1, M6: with the event's chip still removed, an empty box hints to type -- the
  // page searches the whole archive now, so its own list isn't shown; "clear all" brings both back.
  await box.fill('');
  await expect(page.locator('.c-search__hint')).toHaveText('type to search everything');
  await expect(page.locator('[data-event-sections]')).toBeHidden();
  await page.locator('[data-action="clear-filters"]').click();
  await expect(page.locator('[data-event-sections]')).toBeVisible();
  await expect(chip).toBeVisible();
});

test('fix round 1, I1: clearing and typing again never flashes the old results, even while the new search is slow; the live region announces the new count', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), LIGHT_ONLY);
  await gotoReady(page, `/?q=${Q}`);
  await expect(countLine(page)).toHaveText('7 translations · best match first');
  /** @type {string[]} */
  const seen = [];
  await page.exposeFunction('noteCount', (/** @type {string} */ text) => { seen.push(text); });
  await page.evaluate(() => {
    new MutationObserver(() => {
      const line = document.querySelector('.c-search__count');
      const area = document.querySelector('.c-search');
      if (line && area && !area.hidden) /** @type {any} */ (window).noteCount(line.textContent);
    }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  // The next search answers only after a delay, so any stale content would show meanwhile.
  await page.route('**/api/search?*q=today*', async (route) => {
    await new Promise((resolve) => { setTimeout(resolve, 800); });
    await route.continue();
  });
  const box = page.locator('.c-header__search-box');
  await box.fill('');
  await expect(page.locator('[data-search-list]')).toBeVisible();
  await box.fill('today');
  await expect(page.locator('.c-search')).toHaveAttribute('aria-busy', 'true');
  await expect(countLine(page)).toHaveText('4 translations · best match first');
  await expect(page.locator('.c-search')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.c-search__status')).toHaveText('4 translations · best match first');
  expect(seen.filter((text) => text.startsWith('7 ')), `old count lines seen: ${JSON.stringify(seen)}`).toEqual([]);
});

test('person page: preset person chip; removing it widens the results; "clear all" brings it back', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), LIGHT_ONLY);
  await gotoReady(page, `/p/solsunny?q=${Q}`);
  await expect(page.locator('.c-header__search-box')).toHaveAttribute('placeholder', 'search sol…');
  await expect(countLine(page)).toHaveText('4 translations · best match first');
  await page.locator('[data-action="remove-filter"][data-field="people"]').click();
  await expect(countLine(page)).toHaveText('7 translations · best match first');
  expect(new URL(page.url()).search).toBe(`?q=${Q}&scope=all`);
  await page.locator('[data-action="clear-filters"]').click();
  await expect(countLine(page)).toHaveText('4 translations · best match first');
  await expect(page.locator('[data-action="remove-filter"][data-field="people"]')).toBeVisible();
});

test('/search?q=x redirects to /?q=x (308), straight into the results', async ({ page, request }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), LIGHT_ONLY);
  const res = await request.get(`/search?q=${Q}&people=1&people=2`, { maxRedirects: 0 });
  expect(res.status()).toBe(308);
  expect(res.headers().location).toBe(`/?q=${Q}&people=1&people=2`);
  await gotoReady(page, `/search?q=${Q}`);
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(`/?q=${Q}`);
  await expect(countLine(page)).toHaveText('7 translations · best match first');
});

test('the filter sheet: opens from the icon, keeps focus inside, Escape closes it and returns focus; a scoped page\'s own filter is already selected in it', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), LIGHT_ONLY);
  await gotoReady(page, EVENT);
  const filterBtn = page.locator('.c-header__filter-btn');
  await filterBtn.click();
  const dialog = page.locator('.c-filter-sheet');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-filter="event"]')).toHaveValue('solluna-at-starfest-2026-10-18');
  // showModal() makes the rest of the page inert: Tab only ever reaches the sheet's own
  // controls (or the browser's own UI, which leaves document.body active), never the page behind.
  let inside = 0;
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return 'none';
      return el.closest('.c-filter-sheet') ? 'sheet' : 'page';
    });
    expect(where, `tab ${i + 1}`).not.toBe('page');
    if (where === 'sheet') inside += 1;
  }
  expect(inside).toBeGreaterThan(10);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(filterBtn).toBeFocused();
});

test('filters work with an empty box: applying a person from the sheet shows results in place, with its chip and "clear all"', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), LIGHT_ONLY);
  await gotoReady(page, '/');
  await page.locator('.c-header__filter-btn').click();
  await page.locator('[data-filter-group="people"] .c-chips__chip').first().click();
  await page.locator('.c-filter-sheet__apply').click();
  await expect(page.locator('[data-search-list]')).toBeHidden();
  await expect(countLine(page)).toContainText('newest first');
  await expect(page.locator('.c-header__filter-count')).toHaveText('1');
  await page.locator('[data-action="clear-filters"]').click();
  await expect(page.locator('[data-search-list]')).toBeVisible();
});

const NO_FOCUS_PATHS = ['/', `/?q=${Q}`, EVENT, `${EVENT}?q=${Q}`, '/p/solsunny', '/tl/tl_alpha', '/t/1900000000000000001', '/about'];

/** @param {import('@playwright/test').Page} page */
async function expectNothingFocused(page) {
  for (const path of NO_FOCUS_PATHS) {
    await gotoReady(page, path);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => document.activeElement === document.body || document.activeElement === null), path).toBe(true);
  }
}

test('no autofocus on any page, with a mouse', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'fine pointer');
  await expectNothingFocused(page);
});

test.describe('no autofocus: touch phone', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('no page focuses the box on load, so no keyboard pops up', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'touch devices');
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'touch emulated').toBe(true);
    await expectNothingFocused(page);
  });
});

test('desktop: the box sits in the content column under the pinned bar on home and the scoped pages; a phone pins it just below the bar', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), LIGHT_ONLY);
  const desktop = testInfo.project.name === 'desktop';
  for (const path of ['/', EVENT, '/p/solsunny', '/tl/tl_alpha']) {
    await gotoReady(page, path);
    await page.evaluate(() => window.scrollTo(0, 400));
    const [row, bar, column] = await Promise.all(['.c-header__search', '.c-header__bar', 'main.container'].map((s) => page.locator(s).boundingBox()));
    const r = /** @type {{x: number, y: number, width: number, height: number}[]} */ ([row, bar, column]);
    if (desktop) {
      expect(r[0].x, path).toBeGreaterThanOrEqual(r[2].x);
      expect(r[0].x + r[0].width, path).toBeLessThanOrEqual(r[2].x + r[2].width + 1);
    } else {
      const row = page.locator('.c-header__below--live');
      await expect(row, path).toHaveCSS('position', 'sticky');
      await expect(row, path).toHaveCSS('top', `${Math.round(r[1].height)}px`);
      // Pinned once the page has scrolled past whatever sits above the row (home's tagline).
      const scrollY = await page.evaluate(() => window.scrollY);
      if (scrollY >= 60) expect(Math.abs(r[0].y - (r[1].y + r[1].height)), `${path}: pinned just below the bar`).toBeLessThanOrEqual(12);
    }
    await expect(page.locator('.c-header__find')).toHaveCount(0);
  }
  await expect(page.locator('.c-tabbar a')).toHaveText(['home', '＋ add', 'me']);
});
