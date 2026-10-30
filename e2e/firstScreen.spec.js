// @ts-check
/**
 * Task 11: a page's API request starts alongside its JS. The home page's
 * `<link rel="preload" as="fetch" ... crossorigin>` (src/html/index.html)
 * and the item and event pages' (src/services/meta.js) must be the very request the
 * page JS then makes: one request each, and never Chromium's "preloaded
 * ... but not used within a few seconds" warning, which it logs a few
 * seconds after `load` when a preload goes unclaimed (a mismatched URL,
 * mode or credentials).
 */
import { test, expect } from '@playwright/test';
import { gotoReady, stubSyntheticMedia, DARK_PROJECTS } from './helpers.js';

const LONG = '1900000000000000001';
const EVENT_SLUG = 'solluna-at-starfest-2026-10-18';
/** Long enough after `load` for Chromium's unused-preload warning to have fired. */
const UNUSED_PRELOAD_WAIT_MS = 3500;

test('home and item pages request their API once (and the event page), and the preload is used', async ({ page }, testInfo) => {
  test.skip(DARK_PROJECTS.includes(testInfo.project.name), 'requests, not colour: light projects only');
  test.setTimeout(40_000);
  await stubSyntheticMedia(page);
  /** @type {string[]} */
  const warnings = [];
  page.on('console', (msg) => { if (/preload/i.test(msg.text())) warnings.push(msg.text()); });
  /** @type {string[]} */
  const api = [];
  page.on('request', (request) => { const { pathname } = new URL(request.url()); if (pathname.startsWith('/api/')) api.push(pathname); });

  for (const [path, apiPath] of [['/', '/api/home'], [`/t/${LONG}`, `/api/item/translation/${LONG}`], [`/e/${EVENT_SLUG}`, `/api/event/${EVENT_SLUG}`]]) {
    api.length = 0;
    await gotoReady(page, path);
    await expect(page.locator(`link[rel="preload"][as="fetch"][href="${apiPath}"]`)).toHaveCount(1);
    await page.waitForTimeout(UNUSED_PRELOAD_WAIT_MS);
    expect(api.filter((p) => p === apiPath), `${path}: ${api.join(', ')}`).toEqual([apiPath]);
  }
  expect(warnings).toEqual([]);
});
