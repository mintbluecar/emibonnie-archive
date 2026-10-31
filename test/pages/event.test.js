// @ts-check
/**
 * DOM-free tests of `composeEvent` (pure: `EventView` -> `SafeHtml`), on
 * snapshots of the real `/api/event/:slug` response -- generated from
 * `eventView()` against the seeded example site the same way
 * test/services/hubs.test.js does (see that file's "eventView" tests).
 * `event.json`: the whole event, unpaged (`hasMore: false`).
 * `event-paged.json`: the same event with `limit: 1` (`hasMore: true`),
 * for the "more" button branch (Task 3 ruling 3).
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import { mount } from '../../public/js/core/dom.js';
import { MiniElement, fakeDocument } from '../helpers/miniDom.js';
// Dynamic import: see test/components/header.test.js for why.
const { composeEvent, bind, start } = await import('../../public/js/pages/event.js');

const EVENT = JSON.parse(readFileSync(new URL('../snapshots/event.json', import.meta.url), 'utf8'));
const EVENT_PAGED = JSON.parse(readFileSync(new URL('../snapshots/event-paged.json', import.meta.url), 'utf8'));

/** One macrotask tick, enough for a single `await getJson(...)` chain (mocked fetch + .json()) to settle. */
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

test('composeEvent: back link, name, and the translation section with its entries', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /<a class="meta tap-link" href="\/" data-slug=/);
  assert.match(markup, /<h1 class="heading heading--md">SOLLUNA HAPPY DAY<\/h1>/);
  assert.match(markup, /data-kind="translation"/);
  assert.match(markup, /href="\/t\/1900000000000000002"/);
  assert.match(markup, /href="\/t\/1900000000000000003"/);
});

test('composeEvent: the meta line is built from the real counts and copy', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /19 Oct 2026 · 2 translations · 2 translators/);
});

test('composeEvent: hashtag pills, and no type/client pill when the event has none', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /#SLHappyDay2026/);
  assert.match(markup, /#fanclip/);
});

test('composeEvent: no "more" button when a section has no further page', () => {
  const markup = String(composeEvent(EVENT));
  assert.ok(!markup.includes('data-action="more"'));
});

test('composeEvent: a "more" button with the right data-kind/data-offset when a section has hasMore', () => {
  const markup = String(composeEvent(EVENT_PAGED));
  assert.match(markup, /data-offset="1"/);
  assert.match(markup, /<button type="button" class="btn btn--quiet btn--block" data-action="more" data-kind="translation">more<\/button>/);
});

test('composeEvent: the newest-first toggle and the report link', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /<button type="button" class="btn btn--quiet c-event__newest-toggle" aria-pressed="false" data-action="newest-first">newest first<\/button>/);
  assert.match(markup, /<button class="btn btn--quiet c-event__report" type="button" data-action="report">report<\/button>/);
  assert.match(markup, /<dialog[^>]*aria-labelledby="c-report-title"/);
});

test('composeEvent (Task 10d): searches within the event -- its box says so, its entries are the in-place list, and there is no separate search icon', async () => {
  const { eventSearch } = await import('../../public/js/pages/event.js');
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /placeholder="search this event…"/);
  assert.ok(!markup.includes('c-event__search'), 'no icon to a search page');
  assert.ok(!markup.includes('/search'));
  assert.match(markup, /<div data-search-list>[\s\S]*data-event-sections/, 'the list is the entries and their own controls');
  assert.ok(markup.indexOf('SOLLUNA HAPPY DAY</h1>') < markup.indexOf('data-search-list'), 'the event\'s head stays above the results');
  const search = eventSearch(EVENT.event, 'q=hug');
  assert.equal(search.state.event, EVENT.event.slug, 'the event is preset');
  assert.match(String(composeEvent(EVENT, search)), /data-field="event"[^>]*aria-label="remove SOLLUNA HAPPY DAY/);
});

test('composeEvent: includes the page shell\'s compact header, so the wide top bar shows the logo/wordmark too (review #3)', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /<header class="c-header" data-compact>/);
  assert.match(markup, /c-header__wordmark/);
  assert.match(markup, /c-tabbar/);
  assert.match(markup, /c-footer__links/);
});

test('bind: the newest-first toggle re-fetches order=desc and reorders the real DOM -- not a CSS flip (review #1)', async () => {
  const root = new MiniElement('div');
  mount(root, composeEvent(EVENT));
  globalThis.document = fakeDocument();
  const reversed = { ...EVENT, sections: EVENT.sections.map((/** @type {any} */ s) => ({ ...s, items: [...s.items].reverse() })) };
  /** @type {string[]} */
  const seenUrls = [];
  mock.method(globalThis, 'fetch', async (/** @type {string} */ url) => {
    seenUrls.push(String(url));
    return new Response(JSON.stringify(reversed), { status: 200 });
  });
  try {
    bind(root, EVENT, EVENT.event.slug);
    const before = root.querySelectorAll('.c-preview-card__link').map((c) => c.getAttribute('href'));
    const toggle = /** @type {any} */ (root.querySelector('[data-action="newest-first"]'));
    assert.ok(toggle);
    toggle.click();
    await flush();
    assert.ok(seenUrls.some((u) => u.includes('order=desc')), seenUrls.join(', '));
    const after = root.querySelectorAll('.c-preview-card__link').map((c) => c.getAttribute('href'));
    assert.deepEqual(after, [...before].reverse(), 'the real DOM order changed, not just a CSS class');
    assert.equal(toggle.getAttribute('aria-pressed'), 'true');
    assert.ok(!(root.querySelector('[data-event-sections]')?.getAttribute('class') ?? '').includes('is-newest-first'), 'no leftover CSS-flip class');
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
  }
});

test('start: a non-404 failure renders the generic page.loadFailed fallback, never throws (review round 1, I5)', async () => {
  const root = new MiniElement('div');
  globalThis.document = /** @type {any} */ ({
    createElement: (/** @type {any} */ tag) => new MiniElement(tag), getElementById: (/** @type {string} */ id) => (id === 'app' ? root : null), title: '',
  });
  globalThis.window = /** @type {any} */ ({ location: { pathname: `/e/${EVENT.event.slug}`, href: `http://localhost/e/${EVENT.event.slug}` } });
  mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
  try {
    await start();
    assert.match(root.querySelector('.c-empty-state__message')?.children?.[0]?.textContent ?? '', /something went wrong, try again/);
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
    delete (/** @type {any} */ (globalThis)).window;
  }
});

test('composeEvent (fix round 1, I2): entries are compact previews -- opening lines as "emoji text", no full bubbles (spec: entries show their opening lines as a preview)', () => {
  const root = new MiniElement('div');
  mount(root, composeEvent(EVENT));
  const cards = root.querySelectorAll('.c-preview-card');
  assert.ok(cards.length > 0);
  assert.ok(cards.every((c) => c.getAttribute('data-compact') !== null));
  assert.equal(root.querySelectorAll('.c-bubbles__msg').length, 0);
});

test('bind (Task 11, R25): the first screen\'s pictures load eagerly; entries a "more" page appends load lazily', async () => {
  const thumb = { url: 'https://pbs.twimg.com/media/x?format=jpg&name=small', width: 4, height: 5, video: false };
  /** @param {any} view */
  const withThumbs = (view) => ({ ...view, sections: view.sections.map((/** @type {any} */ s) => ({ ...s, items: s.items.map((/** @type {any} */ i) => ({ ...i, thumb })) })) });
  const root = new MiniElement('div');
  mount(root, composeEvent(withThumbs(EVENT_PAGED)));
  globalThis.document = fakeDocument();
  const more = withThumbs({ ...EVENT, sections: EVENT.sections.map((/** @type {any} */ s) => ({ ...s, hasMore: false })) });
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(more), { status: 200 }));
  try {
    bind(root, EVENT_PAGED, EVENT_PAGED.event.slug);
    const loading = () => root.querySelectorAll('.c-thumb__img').map((img) => img.getAttribute('loading'));
    assert.deepEqual(loading(), ['eager']);
    /** @type {any} */ (root.querySelector('[data-action="more"]')).click();
    await flush();
    const after = loading();
    assert.ok(after.length > 1, 'the "more" page appended entries');
    assert.deepEqual(after, ['eager', ...after.slice(1).map(() => 'lazy')]);
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
  }
});
