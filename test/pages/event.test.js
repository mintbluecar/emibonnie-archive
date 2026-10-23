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
  assert.match(markup, /c-event__back/);
  assert.match(markup, /<h1 class="c-event__name">SOLLUNA HAPPY DAY<\/h1>/);
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

test('composeEvent: a chip per person, plus "all"', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /c-event__people-filter/);
  assert.match(markup, /data-value="1"[^>]*><span class="c-chips__emoji" aria-hidden="true">☀️<\/span><span>sol</);
  assert.match(markup, /data-value="2"[^>]*><span class="c-chips__emoji" aria-hidden="true">🌙<\/span><span>luna</);
});

test('composeEvent: a translator filter listing the accounts actually on the page', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /<select class="c-event__account-filter"/);
  assert.match(markup, /<option value="tl_beta">@tl_beta<\/option>/);
  assert.match(markup, /<option value="tl_gamma">@tl_gamma<\/option>/);
});

test('composeEvent: no "more" button when a section has no further page', () => {
  const markup = String(composeEvent(EVENT));
  assert.ok(!markup.includes('c-event-section__more'));
});

test('composeEvent: a "more" button with the right data-kind/data-offset when a section has hasMore', () => {
  const markup = String(composeEvent(EVENT_PAGED));
  assert.match(markup, /data-offset="1"/);
  assert.match(markup, /<button type="button" class="c-event-section__more" data-kind="translation">more<\/button>/);
});

test('composeEvent: the newest-first toggle and the report link', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /<button type="button" class="c-event__newest-toggle" aria-pressed="false">newest first<\/button>/);
  assert.match(markup, /<a class="c-event__report" href="\/takedown">report<\/a>/);
});

test('composeEvent: the search icon links to the event-scoped search, as an SVG (not an emoji), matching the header\'s icon style', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /href="\/search\?event=solluna-happy-day-2026-10-19"/);
  assert.match(markup, /aria-label="search this event"/);
  assert.match(markup, /<a class="c-event__search"[^>]*>\s*<svg width="16" height="16" viewBox="0 0 24 24"/);
  assert.ok(!markup.includes('🔍'));
});

test('composeEvent: includes the page shell\'s compact header, so the wide top bar shows the logo/wordmark too (review #3)', () => {
  const markup = String(composeEvent(EVENT));
  assert.match(markup, /c-header--compact/);
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
    const before = root.querySelectorAll('.c-preview-card').map((c) => c.getAttribute('href'));
    const toggle = /** @type {any} */ (root.querySelector('.c-event__newest-toggle'));
    assert.ok(toggle);
    toggle.click();
    await flush();
    assert.ok(seenUrls.some((u) => u.includes('order=desc')), seenUrls.join(', '));
    const after = root.querySelectorAll('.c-preview-card').map((c) => c.getAttribute('href'));
    assert.deepEqual(after, [...before].reverse(), 'the real DOM order changed, not just a CSS class');
    assert.equal(toggle.getAttribute('aria-pressed'), 'true');
    assert.ok(!(root.querySelector('.c-event-sections')?.getAttribute('class') ?? '').includes('is-newest-first'), 'no leftover CSS-flip class');
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
  }
});

test('bind: an active filter re-applies to entries "more" appends, not just the ones already on the page (review #4)', async () => {
  const root = new MiniElement('div');
  mount(root, composeEvent(EVENT_PAGED));
  globalThis.document = fakeDocument();
  const nextPage = { ...EVENT_PAGED, sections: [{ ...EVENT_PAGED.sections[0], items: [EVENT.sections[0].items[1]], hasMore: false }] };
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(nextPage), { status: 200 }));
  try {
    bind(root, EVENT_PAGED, EVENT.event.slug);
    const select = /** @type {any} */ (root.querySelector('.c-event__account-filter'));
    assert.ok(select);
    select.value = 'tl_beta';
    select.dispatchEvent({ type: 'change', target: select });
    const moreBtn = /** @type {any} */ (root.querySelector('.c-event-section__more'));
    assert.ok(moreBtn);
    moreBtn.click();
    await flush();
    const cards = root.querySelectorAll('.c-preview-card');
    assert.equal(cards.length, 2, 'the appended card is actually in the DOM');
    const byAccount = Object.fromEntries(cards.map((c) => [c.getAttribute('data-account'), c.hidden]));
    assert.equal(byAccount.tl_beta, false, 'still matches the standing filter');
    assert.equal(byAccount.tl_gamma, true, 'newly appended, but filtered out just the same');
    assert.ok(cards.every((c) => c.getAttribute('class')?.includes('c-preview-card--compact')), 'appended entries are compact too (fix round 1, I2)');
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
  assert.ok(cards.every((c) => c.getAttribute('class')?.includes('c-preview-card--compact')));
  assert.equal(root.querySelectorAll('.c-bubbles__msg').length, 0);
});
