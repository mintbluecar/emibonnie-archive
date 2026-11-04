// @ts-check
/**
 * Event editing Task 9: the edit event page (`/admin/events/edit`, spec
 * screen ②) in its three modes. `composeAdminEventEdit(state)` is pure;
 * `fetchView` loads what a mode needs and `save` sends the mode's POST.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { copyRe, pattern } from '../helpers/copyMarkup.js';
// Dynamic import: see test/components/header.test.js for why.
const { composeAdminEventEdit, fetchView, pageState, save, bind } = await import('../../public/js/pages/adminEventEdit.js');
const { modeOf } = await import('../../public/js/state/eventFormState.js');
const { MiniElement } = await import('../helpers/miniDom.js');
const { t, tCount } = await import('../../public/js/core/site.js');

const OWNER = { user: /** @type {any} */ ({ isOwner: true }) };
const OPTIONS = { people: [{ id: 1, displayName: 'sol' }], platforms: [{ code: 'tiktok', name: 'tiktok' }] };

/** @param {Partial<any>} [overrides] @returns {any} */
function event(overrides = {}) {
  return {
    id: 3, slug: '2026-10-19/a', name: 'A', occurredOn: '2026-10-19', entryCount: 1, people: [],
    hidden: false, addressLocked: false, keywords: [], hashtags: ['A'], livePeopleIds: [], livePlatformCode: null,
    mergedInto: null, options: OPTIONS, ...overrides,
  };
}

const MERGE = [event({ id: 3, entryCount: 2 }), event({ id: 7, entryCount: 1, hashtags: ['B'] }), event({ id: 9, entryCount: 1 })];

/** @param {string} markup @returns {string} the submit button's opening tag */
const submitTag = (markup) => markup.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? '';

/** @param {(url: string, init?: any) => Response} answer @param {() => Promise<void>} fn */
async function withFetch(answer, fn) {
  /** @type {{ url: string, init?: any }[]} */
  const calls = [];
  mock.method(globalThis, 'fetch', async (/** @type {string} */ url, /** @type {any} */ init) => { calls.push({ url, init }); return answer(url, init); });
  try { await fn(); } finally { mock.restoreAll(); }
  return calls;
}

/** @param {any} body @param {number} [status] */
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('edit mode: the fields of the event, a save button, and no entries list', () => {
  const markup = String(composeAdminEventEdit(pageState(OWNER, modeOf('?id=3'), { events: [event({ name: 'HAPPY DAY' })], missing: [] })));
  assert.match(markup, /c-tabbar/, 'inside the page shell');
  assert.match(markup, /value="HAPPY DAY"/);
  assert.match(submitTag(markup), /type="submit"/);
  assert.match(markup, new RegExp(`>${pattern(t('adminEventEdit.save'))}</button>`));
  assert.doesNotMatch(markup, /<table/);
  assert.match(markup, /href="\/admin\/events"/, 'cancel goes back to the list');
});

test('merge mode: the kept event is the largest, "merge and save", and the move notice counts', () => {
  const markup = String(composeAdminEventEdit(pageState(OWNER, modeOf('?merge=3,7,9'), { events: MERGE, missing: [] })));
  assert.match(markup, new RegExp(`>${pattern(t('adminEventEdit.mergeSave'))}</button>`));
  assert.match(markup, /type="radio"[^>]*value="3"[^>]*checked/);
  const notice = `${tCount('adminEventEdit.moveTweets', 2, { events: tCount('adminEventEdit.events', 2) })}; ${tCount('adminEventEdit.mergeHidden', 2)}`;
  assert.match(markup, copyRe(notice));
  assert.match(markup, /2 tweets from 2 events move into this one; the other 2 events are hidden and their links redirect here/);
  assert.match(markup, /value="#?B"|>#B</, 'the tags combined from every event');
  assert.doesNotMatch(submitTag(markup), /disabled/);
});

test('merge mode: a hidden event carries the hidden badge in the strip, and a visible one is kept by default', () => {
  const events = [event({ id: 3, entryCount: 5, hidden: true }), event({ id: 7, entryCount: 1 })];
  const markup = String(composeAdminEventEdit(pageState(OWNER, modeOf('?merge=3,7'), { events, missing: [] })));
  const badge = new RegExp(`<span class="badge badge--danger">${pattern(t('adminEventEdit.hidden'))}</span>`);
  const option = (/** @type {number} */ id) => markup.match(new RegExp(`<label class="check"><input[^>]*value="${id}"[\\s\\S]*?</label>`))?.[0] ?? '';
  assert.match(option(3), badge);
  assert.doesNotMatch(option(7), badge);
  assert.match(markup, /type="radio"[^>]*value="7"[^>]*checked/);
});

test('merge mode: a hidden merged-away event adds a line that its tweets become visible', () => {
  const events = [event({ id: 3, entryCount: 5, hidden: true }), event({ id: 7, entryCount: 1 })];
  const markup = String(composeAdminEventEdit(pageState(OWNER, modeOf('?merge=3,7'), { events, missing: [] })));
  assert.match(markup, copyRe(tCount('adminEventEdit.hiddenShown', 1)));
  assert.doesNotMatch(markup, copyRe(t('adminEventEdit.hiddenKept')));
});

test('merge mode: a hidden kept event adds a line that the moved tweets will be hidden with it', () => {
  const events = [event({ id: 3, entryCount: 5, hidden: true }), event({ id: 7, entryCount: 1, hidden: true })];
  const markup = String(composeAdminEventEdit(pageState(OWNER, modeOf('?merge=3,7'), { events, missing: [] })));
  assert.match(markup, copyRe(t('adminEventEdit.hiddenKept')));
  assert.doesNotMatch(markup, copyRe(tCount('adminEventEdit.hiddenShown', 1)), 'they stay hidden in a hidden kept event');
});

test('merge mode: no hidden event, no hidden lines or badges', () => {
  const markup = String(composeAdminEventEdit(pageState(OWNER, modeOf('?merge=3,7,9'), { events: MERGE, missing: [] })));
  assert.doesNotMatch(markup, copyRe(t('adminEventEdit.hiddenKept')));
  assert.doesNotMatch(markup, copyRe(tCount('adminEventEdit.hiddenShown', 1)));
  assert.doesNotMatch(markup, /badge--danger/);
});

test('merge mode: an event that 404d is named, and the merge button is disabled', () => {
  const markup = String(composeAdminEventEdit(pageState(OWNER, modeOf('?merge=3,7'), { events: [MERGE[0]], missing: [7] })));
  assert.match(markup, copyRe(t('adminEventEdit.mergeMissing', { id: 7 })));
  assert.match(submitTag(markup), / disabled/);
});

test('merge mode: every listed event 404d -- each is named, and there is nothing to merge', () => {
  const markup = String(composeAdminEventEdit(pageState(OWNER, modeOf('?merge=7,8'), { events: [], missing: [7, 8] })));
  assert.doesNotMatch(markup, copyRe(t('adminEventEdit.notFound')));
  assert.match(markup, copyRe(t('adminEventEdit.mergeMissing', { id: 7 })));
  assert.match(markup, copyRe(t('adminEventEdit.mergeMissing', { id: 8 })));
  const submit = submitTag(markup);
  assert.ok(submit === '' || / disabled/.test(submit), 'no merge button, or a disabled one');
  assert.match(markup, /href="\/admin\/events"/, 'a way back to the list');
});

test('create mode: "create and move 2 tweets", an empty title, and cancel back to the entries', () => {
  const entries = [{ itemId: 1, occurredOn: '2026-10-21' }, { itemId: 2, occurredOn: '2026-10-20' }];
  const markup = String(composeAdminEventEdit(pageState(OWNER, modeOf('?from=5&items=1,2'), { events: [event({ id: 5, name: 'LISBON' })], missing: [], entries })));
  assert.match(markup, new RegExp(`>${pattern(tCount('adminEventEdit.createSave', 2))}</button>`));
  assert.match(markup, /create and move 2 tweets/);
  assert.match(markup, /<input[^>]*data-event-name[^>]*value=""/);
  assert.match(markup, /value="2026-10-20"/, 'dated by the earliest ticked entry');
  assert.match(markup, copyRe(t('adminEventEdit.createFrom', { name: 'LISBON' })));
  assert.match(markup, /href="\/admin\/events\/entries\?id=5"/);
});

test('create mode: a hidden source event carries the hidden badge in the strip', () => {
  const badge = new RegExp(`<span class="badge badge--danger">${pattern(t('adminEventEdit.hidden'))}</span>`);
  const view = (/** @type {boolean} */ hidden) => ({ events: [event({ id: 5, name: 'LISBON', hidden })], missing: [], entries: [] });
  assert.match(String(composeAdminEventEdit(pageState(OWNER, modeOf('?from=5&items=1'), view(true)))), badge);
  assert.doesNotMatch(String(composeAdminEventEdit(pageState(OWNER, modeOf('?from=5&items=1'), view(false)))), badge);
});

test('a locked event: the address control is disabled', () => {
  const markup = String(composeAdminEventEdit(pageState(OWNER, modeOf('?id=3'), { events: [event({ addressLocked: true })], missing: [] })));
  assert.match(markup, /<select[^>]*data-event-address[^>]*disabled/);
});

test('not found: no data, a non-owner, or an unparseable query; sign-in for a signed-out visitor', () => {
  const notFound = copyRe(t('adminEventEdit.notFound'));
  assert.match(String(composeAdminEventEdit(pageState(OWNER, modeOf('?id=3'), null))), notFound);
  assert.match(String(composeAdminEventEdit(pageState({ user: /** @type {any} */ ({ isOwner: false }) }, modeOf('?id=3'), null))), notFound);
  assert.match(String(composeAdminEventEdit(pageState(OWNER, null, null))), notFound);
  assert.match(String(composeAdminEventEdit(pageState({ user: null }, modeOf('?id=3'), null))), /c-signin/);
});

test('fetchView: merge loads every event and names the ones that 404', async () => {
  /** @type {any} */
  let view;
  const calls = await withFetch((url) => (url.endsWith('/7') ? json({ error: 'not_found' }, 404) : json(event({ id: Number(url.split('/').pop()) }))), async () => {
    view = await fetchView(/** @type {any} */ (modeOf('?merge=3,7,9')));
  });
  assert.deepEqual(calls.map((c) => c.url), ['/api/owner/events/3', '/api/owner/events/7', '/api/owner/events/9']);
  assert.deepEqual(view.events.map((/** @type {any} */ e) => e.id), [3, 9]);
  assert.deepEqual(view.missing, [7]);
});

test('fetchView: create loads the source event and its entries', async () => {
  /** @type {any} */
  let view;
  const calls = await withFetch((url) => (url.endsWith('/entries') ? json({ event: {}, entries: [{ itemId: 1, occurredOn: '2026-01-01' }] }) : json(event({ id: 5 }))), async () => {
    view = await fetchView(/** @type {any} */ (modeOf('?from=5&items=1')));
  });
  assert.deepEqual(calls.map((c) => c.url).sort(), ['/api/owner/events/5', '/api/owner/events/5/entries']);
  assert.equal(view.entries.length, 1);
});

/** The text inside a MiniElement (it has no `textContent` getter), entities still encoded. @param {any} el @returns {string} */
const textOf = (el) => (el ? (el.children ?? []).map((/** @type {any} */ c) => (c.nodeType === 3 ? c.textContent : textOf(c))).join('') : '');

/** @param {any} state */
function mountedPage(state) {
  const root = new MiniElement('div');
  root.innerHTML = String(composeAdminEventEdit(state));
  return root;
}

test('save, edit mode: posts the fields and shows the saved notice', async () => {
  const state = pageState(OWNER, modeOf('?id=3'), { events: [event()], missing: [] });
  const root = mountedPage(state);
  const calls = await withFetch(() => json({ slug: '2026-10-19/a' }), () => save(/** @type {any} */ (root), state));
  assert.equal(calls[0].url, '/api/owner/events/3');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    name: 'A', occurredOn: '2026-10-19', keywords: [], hashtags: ['A'], livePeopleIds: [], livePlatformCode: null, addressTag: 'A',
  });
  assert.ok(root.querySelector('[data-event-edit-status] [data-notice="saved"]'), 'the saved notice');
});

test('save: a 409 merged tells the owner the event was merged elsewhere', async () => {
  const state = pageState(OWNER, modeOf('?id=3'), { events: [event()], missing: [] });
  const root = mountedPage(state);
  await withFetch(() => json({ error: 'merged' }, 409), () => save(/** @type {any} */ (root), state));
  assert.ok(root.querySelector('[data-event-edit-status] [data-notice="merged"]'), 'the merged notice');
});

test('save, merge mode: posts keepId, mergeIds and fields, then opens the kept event', async () => {
  const state = pageState(OWNER, modeOf('?merge=3,7,9'), { events: MERGE, missing: [] });
  /** @type {string[]} */
  const went = [];
  state.go = (/** @type {string} */ href) => { went.push(href); };
  const root = mountedPage(state);
  const calls = await withFetch(() => json({ slug: '2026-10-19/a', moved: 2 }), () => save(/** @type {any} */ (root), state));
  assert.equal(calls[0].url, '/api/owner/events/merge');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.keepId, 3);
  assert.deepEqual(body.mergeIds, [7, 9]);
  assert.deepEqual(body.fields.hashtags, ['A', 'B']);
  assert.deepEqual(went, ['/admin/events/edit?id=3']);
});

test('save, create mode: posts the split, then opens the new event', async () => {
  const entries = [{ itemId: 1, occurredOn: '2026-10-21' }, { itemId: 2, occurredOn: '2026-10-20' }];
  const state = pageState(OWNER, modeOf('?from=5&items=1,2'), { events: [event({ id: 5 })], missing: [], entries });
  state.store.fields.name = 'New one';
  /** @type {string[]} */
  const went = [];
  state.go = (/** @type {string} */ href) => { went.push(href); };
  const root = mountedPage(state);
  const calls = await withFetch(() => json({ eventId: 12, slug: '2026-10-20/new-one', moved: 2 }), () => save(/** @type {any} */ (root), state));
  assert.equal(calls[0].url, '/api/owner/events/5/split');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.itemIds, [1, 2]);
  assert.equal(body.fields.name, 'New one');
  assert.equal(body.fields.addressTag, 'New one', 'the title stands in for the address');
  assert.deepEqual(went, ['/admin/events/edit?id=12']);
});

test('bind: choosing a hidden kept event adds the hidden line to the move notice', () => {
  const events = [event({ id: 3, entryCount: 2 }), event({ id: 7, entryCount: 1, hidden: true })];
  const state = pageState(OWNER, modeOf('?merge=3,7'), { events, missing: [] });
  const root = mountedPage(state);
  bind(/** @type {any} */ (root), state);
  const notice = () => textOf(root.querySelector('[data-event-move-notice]'));
  assert.match(notice(), copyRe(tCount('adminEventEdit.hiddenShown', 1)));
  root.dispatchEvent({ type: 'change', target: /** @type {any} */ (root.querySelector('input[type="radio"][value="7"]')) });
  assert.match(notice(), copyRe(t('adminEventEdit.hiddenKept')));
  assert.doesNotMatch(notice(), copyRe(tCount('adminEventEdit.hiddenShown', 1)));
});

test('bind: choosing another kept event re-seeds the title from it and keeps the combined tags', () => {
  const events = [event({ id: 3, entryCount: 2, name: 'Big' }), event({ id: 7, entryCount: 1, name: 'Small', hashtags: ['B'] })];
  const state = pageState(OWNER, modeOf('?merge=3,7'), { events, missing: [] });
  const root = mountedPage(state);
  bind(/** @type {any} */ (root), state);
  const radio = /** @type {any} */ (root.querySelector('input[type="radio"][value="7"]'));
  root.dispatchEvent({ type: 'change', target: radio });
  assert.equal(state.keepId, 7);
  assert.equal(state.store.fields.name, 'Small');
  assert.deepEqual(state.store.fields.hashtags, ['A', 'B']);
  assert.equal(root.querySelector('[data-event-form] [data-event-name]')?.getAttribute('value'), 'Small', 'the form repainted');
});
