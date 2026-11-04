// @ts-check
/**
 * Event editing Task 8: the owner's events list (`/admin/events`, spec
 * screen ①). `composeAdminEvents(data, state)` is pure; `load` is the
 * page's one fetch, guarded by its sequence check.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { copyRe, pattern } from '../helpers/copyMarkup.js';
// Dynamic import: see test/components/header.test.js for why.
const { composeAdminEvents, composeResults, load, newState } = await import('../../public/js/pages/adminEvents.js');
const { MiniElement } = await import('../helpers/miniDom.js');
const { t } = await import('../../public/js/core/site.js');

const OWNER = { user: /** @type {any} */ ({ isOwner: true }) };

/** @param {Partial<any>} [overrides] */
function row(overrides = {}) {
  return {
    id: 3, slug: '2026-10-19/happy-day', name: 'HAPPY DAY', occurredOn: '2026-10-19',
    entryCount: 2, people: ['sol', 'luna'], hidden: false, addressLocked: false, ...overrides,
  };
}

const TWO = { events: [row(), row({ id: 7, slug: '2026-10-20/other', name: 'OTHER', entryCount: 1, people: [] })], total: 2 };

/** @param {Partial<any>} [overrides] */
function state(overrides = {}) {
  return { ...newState(OWNER), ...overrides };
}

/** @param {string} markup @returns {string} the merge control's opening tag */
function mergeTag(markup) {
  return markup.match(/<(?:a|button)[^>]*data-admin-events-merge[^>]*>/)?.[0] ?? '';
}

test('two rows render two Edit and two Tweets buttons with the right hrefs', () => {
  const markup = String(composeAdminEvents(TWO, state()));
  assert.match(markup, /c-tabbar/, 'inside the page shell');
  for (const id of [3, 7]) {
    assert.match(markup, new RegExp(`href="/admin/events/edit\\?id=${id}">${pattern(t('adminEvents.edit'))}</a>`));
    assert.match(markup, new RegExp(`href="/admin/events/entries\\?id=${id}">${pattern(t('adminEvents.tweets'))}</a>`));
  }
  assert.equal(markup.match(/href="\/admin\/events\/edit\?id=/g)?.length, 2);
  assert.equal(markup.match(/href="\/admin\/events\/entries\?id=/g)?.length, 2);
});

test('each row shows its date, name, entry count and people', () => {
  const markup = String(composeAdminEvents(TWO, state()));
  assert.match(markup, /2026-10-19/);
  assert.match(markup, /HAPPY DAY/);
  assert.match(markup, /sol, luna/);
  assert.match(markup, /class="table__num"[^>]*>2</);
});

test('the merge button is disabled with one tick', () => {
  const tag = mergeTag(String(composeResults(TWO, state({ ticked: new Set([3]) }))));
  assert.match(tag, /^<button/);
  assert.match(tag, / disabled/);
});

test('ticks on ids 3 and 7 make the merge button a link to ?merge=3,7', () => {
  const markup = String(composeResults(TWO, state({ ticked: new Set([3, 7]) })));
  const tag = mergeTag(markup);
  assert.match(tag, /^<a/);
  assert.match(tag, /href="\/admin\/events\/edit\?merge=3,7"/);
  assert.match(markup, copyRe(t('adminEvents.merge', { n: 2 })));
  assert.equal(markup.match(/data-action="tick"[^>]*checked/g)?.length, 2, 'both boxes stay ticked');
});

test('a hidden event shows the hidden badge; a visible one does not', () => {
  const hidden = String(composeResults({ events: [row({ hidden: true })], total: 1 }, state()));
  assert.match(hidden, new RegExp(`<span class="badge[^"]*">${pattern(t('adminEvents.hidden'))}</span>`));
  assert.doesNotMatch(String(composeResults({ events: [row()], total: 1 }, state())), /class="badge/);
});

test('a signed-in non-owner sees the not-found state, not the list', () => {
  const markup = String(composeAdminEvents(TWO, newState({ user: /** @type {any} */ ({ isOwner: false }) })));
  assert.match(markup, copyRe(t('adminEvents.notFound')));
  assert.doesNotMatch(markup, /admin\/events\/edit/);
});

test('no data (the API refused) sees the not-found state', () => {
  assert.match(String(composeAdminEvents(null, state())), copyRe(t('adminEvents.notFound')));
});

test('a signed-out visitor is asked to sign in', () => {
  const markup = String(composeAdminEvents(null, newState({ user: null })));
  assert.match(markup, /c-signin/);
  assert.doesNotMatch(markup, copyRe(t('adminEvents.notFound')));
});

test('no match shows the empty message and no table', () => {
  const markup = String(composeResults({ events: [], total: 0 }, state({ q: 'zzz' })));
  assert.match(markup, copyRe(t('adminEvents.empty')));
  assert.doesNotMatch(markup, /<table/);
});

test('pagination: older while more remain, newer once past the first page', () => {
  const first = String(composeResults({ events: [row()], total: 120 }, state()));
  assert.match(first, /data-action="page" data-offset="50"/);
  assert.equal(first.match(/data-action="page"/g)?.length, 1, 'no newer on the first page');
  const middle = String(composeResults({ events: [row()], total: 120 }, state({ offset: 50 })));
  assert.match(middle, /data-action="page" data-offset="0"/);
  assert.match(middle, /data-action="page" data-offset="100"/);
  const last = String(composeResults({ events: [row()], total: 120 }, state({ offset: 100 })));
  assert.match(last, /data-action="page" data-offset="50"/);
  assert.doesNotMatch(last, /data-offset="150"/);
});

test('load: sends q and offset, paints, and drops a response a newer request overtook', async () => {
  /** @type {((value: Response) => void)[]} */
  const pending = [];
  /** @type {string[]} */
  const urls = [];
  mock.method(globalThis, 'fetch', (/** @type {string} */ url) => new Promise((resolve) => { urls.push(url); pending.push(resolve); }));
  try {
    const root = new MiniElement('div');
    const s = state({ q: 'happy', offset: 50 });
    const first = load(/** @type {any} */ (root), s);
    const second = load(/** @type {any} */ (root), s);
    pending[1](new Response(JSON.stringify({ events: [row({ id: 3 })], total: 51 })));
    await second;
    pending[0](new Response(JSON.stringify({ events: [row({ id: 9 })], total: 51 })));
    await first;
    assert.equal(urls[0], '/api/owner/events?q=happy&offset=50');
    assert.equal(root.getAttribute('data-ready'), '');
    const ids = root.querySelectorAll('tr[data-event]').map((tr) => tr.getAttribute('data-event'));
    assert.deepEqual(ids, ['3']);
  } finally {
    mock.restoreAll();
  }
});
