// @ts-check
/**
 * Task 10c's browser checks, on the bundled example (same server as
 * smoke.spec.js): the forced light/dark themes (axe in both), the item
 * media that pins where it starts, a full-width header at in-between
 * widths, centred emoji, long URLs that wrap, and the theme switch.
 */
import { test, expect } from '@playwright/test';
import { checkPage, gotoReady, stubSyntheticMedia, DARK_PROJECTS } from './helpers.js';

const LONG = '1900000000000000001';
const LIVE = '1900000000000000004';
const PAGES = [['home', '/'], ['event', '/e/solluna-at-starfest-2026-10-18'], ['item', `/t/${LONG}`], ['search', `/search?q=${encodeURIComponent('ครบ')}`], ['person', '/p/solsunny']];

/** Forces `choice` the way the switch remembers it, before any page script. @param {import('@playwright/test').Page} page @param {string} choice */
async function forceTheme(page, choice) {
  await page.addInitScript((value) => { try { localStorage.setItem('theme', value); } catch { /* none */ } }, choice);
}

for (const [name, path] of PAGES) {
  test(`${name} (Task 10c f): forced to the opposite of the device's theme, it shows that theme and passes the page checks (axe included)`, async ({ page }, testInfo) => {
    const forced = DARK_PROJECTS.includes(testInfo.project.name) ? 'light' : 'dark';
    await forceTheme(page, forced);
    await checkPage(page, path);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(forced);
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(forced === 'dark' ? 'rgb(20, 15, 25)' : 'rgb(246, 239, 227)');
  });
}

test('theme switch (Task 10c f): cycles light, dark, follow the device; its label says which; remembered across a reload', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'the cycle is the same in every project');
  await gotoReady(page, '/');
  const toggle = page.locator('.c-header .c-theme-toggle');
  const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await expect(toggle).toHaveAttribute('aria-label', 'theme: follow device');
  await toggle.click();
  expect(await theme()).toBe('light');
  await expect(toggle).toHaveAttribute('title', 'theme: light');
  await toggle.click();
  expect(await theme()).toBe('dark');
  await page.reload();
  await page.waitForSelector('#app[data-ready]', { state: 'attached' });
  expect(await theme()).toBe('dark');
  await expect(toggle).toHaveAttribute('aria-label', 'theme: dark');
  await toggle.click();
  expect(await theme()).toBe(null);
});

test('item media (Task 10c k): pins exactly where it starts on desktop; on a phone it pins --item-media-gap below the bar and never moves after', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'layout, not colour');
  await stubSyntheticMedia(page);
  await gotoReady(page, `/t/${LONG}`);
  const top = () => page.locator('.c-item__media').evaluate((el) => el.getBoundingClientRect().top);
  const barBottom = await page.locator('.c-header__bar').evaluate((el) => el.getBoundingClientRect().bottom);
  const at0 = await top();
  await page.evaluate(() => window.scrollTo(0, 600));
  await expect.poll(top).toBeGreaterThan(0);
  const at600 = await top();
  if (testInfo.project.name === 'desktop') {
    expect(Math.abs(at600 - at0)).toBeLessThanOrEqual(1);
    expect(at0 - barBottom).toBeCloseTo(16, 0);
  } else {
    // A phone's search row and back link sit above the media, so it rises until it pins.
    expect(at600 - barBottom).toBeCloseTo(8, 0);
    await page.evaluate(() => window.scrollTo(0, 900));
    expect(Math.abs((await top()) - at600)).toBeLessThanOrEqual(1);
  }
});

test('LIVE at phone width (Task 10c k): with the gap, the first bubble still shows without scrolling', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout');
  await stubSyntheticMedia(page);
  await gotoReady(page, `/t/${LIVE}`);
  const first = await page.locator('.c-bubbles__msg, .c-bubbles__plain').first().evaluate((el) => el.getBoundingClientRect().top);
  expect(first).toBeLessThan(844);
});

for (const width of [390, 700, 1280]) {
  test(`header at ${width}px (Task 10c n): the bar, tab bar and footer span the viewport, with a 120-character URL in a bubble and no sideways scroll`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'viewport set per test');
    await page.setViewportSize({ width, height: 900 });
    await stubSyntheticMedia(page);
    await gotoReady(page, `/t/${LONG}`);
    await page.locator('.c-bubbles__bub').first().evaluate((el) => { el.append(` https://x.com/phannii_p/status/2108523935654670719/video/1?${'q'.repeat(60)}`); });
    const m = await page.evaluate(() => {
      const w = (/** @type {string} */ s) => document.querySelector(s)?.getBoundingClientRect().width ?? -1;
      return { client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, bar: w('.c-header__bar'), tabs: w('.c-tabbar'), footer: w('footer') };
    });
    expect(m.scroll).toBeLessThanOrEqual(m.client);
    expect(m.bar).toBe(m.client);
    if (width < 860) expect(m.tabs).toBe(m.client);
    expect(m.footer).toBeLessThanOrEqual(m.client);
  });
}

test('a long URL in a bubble (Task 10c p): wraps inside the bubble, which stays in its column, at 390px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone', 'phone layout');
  await stubSyntheticMedia(page);
  await gotoReady(page, `/t/${LONG}`);
  const url = `https://x.com/phannii_p/status/2108523935654670719/video/1?${'x'.repeat(61)}`;
  expect(url.length).toBe(120);
  const r = await page.locator('.c-bubbles__bub').first().evaluate((el, text) => {
    el.append(` …${text}`);
    const column = /** @type {Element} */ (el.closest('.c-bubbles')).getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { scroll: el.scrollWidth, client: el.clientWidth, right: box.right, columnRight: column.right };
  }, url);
  expect(r.scroll).toBeLessThanOrEqual(r.client);
  expect(r.right).toBeLessThanOrEqual(r.columnRight + 0.5);
});

test('emoji (Task 10c o): each avatar\'s emoji is centred in its circle, within 1.5px', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'layout, not colour');
  await gotoReady(page, `/t/${LONG}`);
  const offsets = await page.locator('.c-bubbles__avatar:not(.c-bubbles__avatar--blank):not(.c-bubbles__avatar--none)').evaluateAll((els) => els.map((el) => {
    const text = /** @type {Node} */ (el.querySelector('.c-emoji')?.firstChild);
    const range = document.createRange();
    range.selectNodeContents(text);
    const glyph = range.getBoundingClientRect();
    const circle = el.getBoundingClientRect();
    return Math.max(Math.abs((glyph.top + glyph.height / 2) - (circle.top + circle.height / 2)), Math.abs((glyph.left + glyph.width / 2) - (circle.left + circle.width / 2)));
  }));
  expect(offsets.length).toBeGreaterThan(0);
  for (const off of offsets) expect(off).toBeLessThanOrEqual(1.5);
});

test('item page (Task 10c r): no search box at any width, and the bar\'s search icon (phone) links home', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'layout, not colour');
  await gotoReady(page, `/t/${LONG}`);
  await expect(page.locator('input[type="search"]')).toHaveCount(0);
  await expect(page.locator('.c-header__find')).toHaveAttribute('href', '/');
  if (testInfo.project.name === 'phone') await expect(page.locator('.c-header__find')).toBeVisible();
});
