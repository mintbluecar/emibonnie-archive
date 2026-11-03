// @ts-check
/**
 * Event editing Task 10: the tweets in an event (`/admin/events/entries`,
 * spec screen ③). `composeAdminEventEntries(data, state)` is pure;
 * `loadEntries` and `searchTargets` are the page's fetches, each guarded
 * by its own sequence check, and `move` sends the move and reloads.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { copyRe, pattern } from '../helpers/copyMarkup.js';
// Dynamic import: see test/components/header.test.js for why.
const { composeAdminEventEntries, entriesIdOf, move, newState, searchTargets, targetsOf, bind } = await import('../../public/js/pages/adminEventEntries.js');
const { MiniElement } = await import('../helpers/miniDom.js');
const { mountPage } = await import('../../public/js/core/dom.js');
const { t, tCount } = await import('../../public/js/core/site.js');

const OWNER = { user: /** @type {any} */ ({ isOwner: true }) };
const ID = 5;

/** @param {Partial<any>} [overrides] @returns {any} */
function eventRow(overrides = {}) {
  return {
    id: ID, slug: '2026-10-19/starfest', name: 'STARFEST', occurredOn: '2026-10-19',
    entryCount: 3, people: ['sol', 'luna'], hidden: false, addressLocked: false, ...overrides,
  };
}

/** @param {Partial<any>} [overrides] @returns {any} */
function entry(overrides = {}) {
  return {
    itemId: 11, kind: 'translation', sourceId: '1900000000000000011', occurredOn: '2026-10-19',
    reviewState: 'published', people: ['sol'], snippet: 'hello there', ...overrides,
  };
}

const DATA = {
  event: eventRow(),
  entries: [
    entry({ itemId: 11 }),
    entry({ itemId: 12, reviewState: 'pending', people: ['sol', 'luna'], snippet: 'second' }),
    entry({ itemId: 13, occurredOn: '2026-10-21', people: [], snippet: '' }),
  ],
};

/** @param {Partial<any>} [overrides] */
function state(overrides = {}) {
  return { ...newState(OWNER, ID), ...overrides };
}

/** @param {string} markup @returns {string} the move button's opening tag */
const moveTag = (markup) => markup.match(/<button[^>]*data-action="move"[^>]*>/)?.[0] ?? '';
/** @param {string} markup @returns {string} the new event control's opening tag */
const newEventTag = (markup) => markup.match(/<(?:a|button)[^>]*data-event-entries-new[^>]*>/)?.[0] ?? '';

/** The text inside a MiniElement (it has no `textContent` getter), entities still encoded, so compare with `pattern()`. @param {any} el @returns {string} */
const textOf = (el) => (el ? (el.children ?? []).map((/** @type {any} */ c) => (c.nodeType === 3 ? c.textContent : textOf(c))).join('') : '');

/** @param {any} body @param {number} [status] */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

/** @param {(url: string, init?: any) => Response} answer @param {() => Promise<void>} fn */
async function withFetch(answer, fn) {
  /** @type {{ url: string, init?: any }[]} */
  const calls = [];
  mock.method(globalThis, 'fetch', async (/** @type {string} */ url, /** @type {any} */ init) => { calls.push({ url, init }); return answer(url, init); });
  try { await fn(); } finally { mock.restoreAll(); }
  return calls;
}

test('entries on two days render two day groups, in the page shell', () => {
  const markup = String(composeAdminEventEntries(DATA, state()));
  assert.match(markup, /c-tabbar/, 'inside the page shell');
  assert.deepEqual([...markup.matchAll(/data-day="([^"]+)"/g)].map((m) => m[1]), ['2026-10-19', '2026-10-21']);
  assert.equal(markup.match(/data-action="tick"/g)?.length, 3, 'one tick box per entry');
});

test('the header has the name, the tweet count and the date range', () => {
  const markup = String(composeAdminEventEntries(DATA, state()));
  assert.match(markup, />STARFEST</);
  assert.match(markup, copyRe(tCount('adminEventEntries.tweets', 3)));
  assert.match(markup, copyRe(t('adminEventEntries.range', { from: '19 Oct 2026', to: '21 Oct 2026' })));
});

test('the header carries the hidden badge only when the event is hidden', () => {
  const badge = new RegExp(`<span class="badge badge--danger">${pattern(t('adminEventEntries.hidden'))}</span>`);
  const head = (/** @type {string} */ markup) => markup.match(/data-event-entries-head>[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.match(head(String(composeAdminEventEntries({ ...DATA, event: eventRow({ hidden: true }) }, state()))), badge);
  assert.doesNotMatch(head(String(composeAdminEventEntries(DATA, state()))), badge);
});

test('each entry shows its people, its snippet and its review state as a badge', () => {
  const markup = String(composeAdminEventEntries(DATA, state()));
  assert.match(markup, /sol, luna/);
  assert.match(markup, /hello there/);
  assert.match(markup, new RegExp(`<span class="badge[^"]*">${pattern(t('adminEventEntries.state.pending'))}</span>`));
  assert.match(markup, new RegExp(`<span class="badge[^"]*">${pattern(t('adminEventEntries.state.published'))}</span>`));
});

test('the move control and "＋ new event" are disabled with no ticks', () => {
  const markup = String(composeAdminEventEntries(DATA, state({ targetId: 7 })));
  assert.match(moveTag(markup), / disabled/);
  assert.match(newEventTag(markup), /^<button[^>]* disabled/);
});

test('"＋ new event" with ticks on 11 and 12 links to the split href', () => {
  const markup = String(composeAdminEventEntries(DATA, state({ ticked: new Set([12, 11]) })));
  const tag = newEventTag(markup);
  assert.match(tag, /^<a/);
  assert.match(tag, new RegExp(`href="/admin/events/edit\\?from=${ID}&amp;items=11,12"`));
  assert.match(moveTag(markup), / disabled/, 'no target picked yet');
  assert.equal(markup.match(/data-action="tick"[^>]*checked/g)?.length, 2);
});

test('ticks and a picked target enable move', () => {
  const markup = String(composeAdminEventEntries(DATA, state({ ticked: new Set([11]), targets: [eventRow({ id: 7 })], targetId: 7 })));
  assert.doesNotMatch(moveTag(markup), /disabled/);
});

test('the current event and hidden events are not offered as targets', () => {
  const found = [eventRow({ id: ID }), eventRow({ id: 7, name: 'OTHER' }), eventRow({ id: 8, name: 'GONE', hidden: true })];
  assert.deepEqual(targetsOf(found, ID).map((e) => e.id), [7]);
  const markup = String(composeAdminEventEntries(DATA, state({ q: 'star', targets: targetsOf(found, ID) })));
  assert.deepEqual([...markup.matchAll(/data-action="target"[^>]*value="(\d+)"/g)].map((m) => m[1]), ['7']);
});

test('the not-found state: a non-owner, a refused API call, or no readable id', () => {
  const notFound = copyRe(t('adminEventEntries.notFound'));
  assert.match(String(composeAdminEventEntries(DATA, newState({ user: /** @type {any} */ ({ isOwner: false }) }, ID))), notFound);
  assert.match(String(composeAdminEventEntries(null, state())), notFound);
  assert.match(String(composeAdminEventEntries(null, newState(OWNER, null))), notFound);
  for (const search of ['', '?id=', '?id=abc', '?id=3.5', '?id=-1']) assert.equal(entriesIdOf(search), null, search);
  assert.equal(entriesIdOf('?id=5'), 5);
});

test('a signed-out visitor is asked to sign in', () => {
  const markup = String(composeAdminEventEntries(null, newState({ user: null }, ID)));
  assert.match(markup, /c-signin/);
  assert.doesNotMatch(markup, copyRe(t('adminEventEntries.notFound')));
});

test('an event with no entries says so', () => {
  const markup = String(composeAdminEventEntries({ event: eventRow({ entryCount: 0 }), entries: [] }, state()));
  assert.match(markup, copyRe(t('adminEventEntries.empty')));
  assert.doesNotMatch(markup, /<table/);
});

test('searchTargets: sends q, drops a response a newer search overtook, and leaves out the current event', async () => {
  /** @type {((value: Response) => void)[]} */
  const pending = [];
  /** @type {string[]} */
  const urls = [];
  mock.method(globalThis, 'fetch', (/** @type {string} */ url) => new Promise((resolve) => { urls.push(url); pending.push(resolve); }));
  try {
    const root = new MiniElement('div');
    const s = state({ q: 'star' });
    mountPage(/** @type {any} */ (root), composeAdminEventEntries(DATA, s));
    const first = searchTargets(/** @type {any} */ (root), s);
    const second = searchTargets(/** @type {any} */ (root), s);
    pending[1](json({ events: [eventRow({ id: ID }), eventRow({ id: 7 })], total: 2 }));
    await second;
    pending[0](json({ events: [eventRow({ id: 9 })], total: 1 }));
    await first;
    assert.equal(urls[0], '/api/owner/events?q=star');
    const offered = root.querySelectorAll('[data-action="target"]').map((el) => el.getAttribute('value'));
    assert.deepEqual(offered, ['7']);
  } finally {
    mock.restoreAll();
  }
});

/** A painted, bound page with 11 and 12 ticked and event 7 picked. */
function tickedPage() {
  const root = new MiniElement('div');
  const s = state({ ticked: new Set([11, 12]), targets: [eventRow({ id: 7, name: 'OTHER' })], targetId: 7 });
  mountPage(/** @type {any} */ (root), composeAdminEventEntries(DATA, s));
  return { root, s };
}

test('move: posts the ticked ids and the target, reloads the entries and clears the ticks', async () => {
  const { root, s } = tickedPage();
  const after = { event: eventRow({ entryCount: 1 }), entries: [DATA.entries[2]] };
  const calls = await withFetch((url) => (url.endsWith('/move') ? json({ moved: 2 }) : json(after)), () => move(/** @type {any} */ (root), s));
  assert.equal(calls[0].url, `/api/owner/events/${ID}/move`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { itemIds: [11, 12], toEventId: 7 });
  assert.equal(calls[1].url, `/api/owner/events/${ID}/entries`);
  assert.equal(s.ticked.size, 0);
  assert.equal(root.querySelectorAll('[data-action="tick"]').length, 1, 'the list is the reloaded one');
  assert.match(textOf(root.querySelector('[data-event-entries-status]')), new RegExp(pattern(tCount('adminEventEntries.moved', 2, { name: 'OTHER' }))));
  assert.equal(root.querySelector('[data-action="move"]')?.getAttribute('disabled'), '', 'move is disabled again');
});

test('move: a failed reload after a move says the move happened', async () => {
  const { root, s } = tickedPage();
  await withFetch((url) => (url.endsWith('/move') ? json({ moved: 2 }) : json({ error: 'oops' }, 500)), () => move(/** @type {any} */ (root), s));
  assert.equal(s.ticked.size, 0);
  assert.match(textOf(root.querySelector('[data-event-entries-status]')), new RegExp(pattern(tCount('adminEventEntries.reloadFailed', 2))));
});

test('move: a 409 shows the merged notice and keeps the ticks', async () => {
  const { root, s } = tickedPage();
  const calls = await withFetch(() => json({ error: 'merged' }, 409), () => move(/** @type {any} */ (root), s));
  assert.equal(calls.length, 1, 'no reload');
  assert.deepEqual([...s.ticked], [11, 12]);
  assert.match(textOf(root.querySelector('[data-event-entries-status]')), new RegExp(pattern(t('adminEventEntries.merged'))));
});

test('move: a 400 shows its reason and keeps the ticks', async () => {
  const { root, s } = tickedPage();
  await withFetch(() => json({ error: 'bad_request', message: 'not in this event' }, 400), () => move(/** @type {any} */ (root), s));
  assert.equal(s.ticked.size, 2);
  assert.match(textOf(root.querySelector('[data-event-entries-status]')), new RegExp(pattern(t('adminEventEntries.invalid', { reason: 'not in this event' }))));
});

test('bind: a tick enables "＋ new event" and updates the move heading', () => {
  const root = new MiniElement('div');
  const s = state();
  mountPage(/** @type {any} */ (root), composeAdminEventEntries(DATA, s));
  bind(/** @type {any} */ (root), s);
  const box = /** @type {any} */ (root.querySelector('[data-action="tick"][value="12"]'));
  box.checked = true;
  root.dispatchEvent({ type: 'change', target: box });
  assert.deepEqual([...s.ticked], [12]);
  // miniDom keeps the markup's entities, so the `&` reads as `&amp;` here.
  assert.equal(root.querySelector('[data-event-entries-new]')?.getAttribute('href'), `/admin/events/edit?from=${ID}&amp;items=12`);
  assert.equal(root.querySelector('[data-event-entries-ticked]')?.textContent, tCount('adminEventEntries.moveHeading', 1));
});
