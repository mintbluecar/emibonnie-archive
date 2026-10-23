// @ts-check
/**
 * `npm run e2e:site` (Task 9a item 1): the engine smoke's per-page checks
 * (e2e/helpers.js's `checkPage`: 200, no console or CSP errors, no
 * horizontal scroll, nothing serious or critical from axe) on **this
 * repo's own** site, built and seeded from `site/seed/` by
 * `playwright.site.config.js`, in all four projects.
 *
 * Nothing here names any site's data: every URL is found through the
 * site's own API --
 * - home, and the first event `/api/home` lists;
 * - the first item of that event (`/api/event/:slug`'s first section);
 * - every person `/api/filters` lists (featured people, and anyone else
 *   on a visible item -- each has a page);
 * - the first translator account `/api/filters` lists;
 * - a search for a word taken from that first item's opening lines;
 * - about, privacy and takedown, and one unknown path (a 404).
 * A seed without an event (or without people, or translators) skips
 * those checks with a reason rather than passing them silently.
 */
import { test, expect } from '@playwright/test';
import { checkPage } from './helpers.js';

/**
 * @param {import('@playwright/test').APIRequestContext} request @param {string} path
 * @returns {Promise<any>}
 */
async function api(request, path) {
  const res = await request.get(path);
  expect(res.status(), `GET ${path}`).toBe(200);
  return res.json();
}

/** @param {import('@playwright/test').APIRequestContext} request @returns {Promise<string|null>} */
async function firstEventSlug(request) {
  const home = await api(request, '/api/home');
  return home.months?.[0]?.events?.[0]?.slug ?? null;
}

/** @param {import('@playwright/test').APIRequestContext} request @returns {Promise<any|null>} the first item's preview */
async function firstItem(request) {
  const slug = await firstEventSlug(request);
  if (!slug) return null;
  const event = await api(request, `/api/event/${encodeURIComponent(slug)}`);
  return event.sections?.[0]?.items?.[0] ?? null;
}

/**
 * A word to search for, from the item's opening lines: the first
 * whitespace-separated run of 3+ letters or digits, else (a script
 * without spaces) the first 3 letters of its text.
 * @param {any} item @returns {string|null}
 */
function searchWordOf(item) {
  const text = (item.lines ?? []).map((/** @type {any} */ line) => line.text ?? '').join(' ');
  const word = text.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).find((w) => [...w].length >= 3);
  if (word) return word;
  const letters = [...text.replace(/[^\p{L}\p{N}]/gu, '')];
  return letters.length >= 3 ? letters.slice(0, 3).join('') : null;
}

test('home: 200, no console errors, no horizontal scroll, no serious a11y violations', async ({ page }) => {
  await checkPage(page, '/');
});

test('the first event on home', async ({ page, request }) => {
  const slug = await firstEventSlug(request);
  test.skip(!slug, 'the seed has no event');
  await checkPage(page, `/e/${encodeURIComponent(/** @type {string} */ (slug))}`);
});

test('the first item of that event', async ({ page, request }) => {
  const item = await firstItem(request);
  test.skip(!item, 'the seed has no event with an item');
  await checkPage(page, item.url);
});

test('every person /api/filters lists', async ({ context, request }) => {
  const { people } = await api(request, '/api/filters');
  const handles = people.map((/** @type {any} */ p) => p.igHandle).filter(Boolean);
  test.skip(handles.length === 0, 'the site lists no people');
  for (const handle of handles) {
    const page = await context.newPage(); // a fresh page each: checkPage installs its error listeners once per page
    await checkPage(page, `/p/${encodeURIComponent(handle)}`);
    await page.close();
  }
});

test('the first translator account', async ({ page, request }) => {
  const { accounts } = await api(request, '/api/filters');
  test.skip(accounts.length === 0, 'the seed has no translator with a visible item');
  await checkPage(page, `/tl/${encodeURIComponent(accounts[0].handle)}`);
});

test('a search for a word from the first item, which finds something', async ({ page, request }) => {
  const item = await firstItem(request);
  const word = item ? searchWordOf(item) : null;
  test.skip(!word, 'the seed has no item with searchable text');
  const q = encodeURIComponent(/** @type {string} */ (word));
  const found = await api(request, `/api/search?q=${q}&limit=0`);
  expect(found.count, `search for ${word}`).toBeGreaterThan(0);
  await checkPage(page, `/search?q=${q}`);
});

for (const path of ['/about', '/privacy', '/takedown']) {
  test(`${path}`, async ({ page }) => {
    await checkPage(page, path);
  });
}

test('an unknown path: 404 status, renders, no console errors', async ({ page }) => {
  await checkPage(page, '/this-page-does-not-exist', { status: 404 });
});
