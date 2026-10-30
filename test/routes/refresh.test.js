// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps, ingest, patchedFetch, rows, SYSTEM } from '../helpers/ingest.js';
import { apiFor } from '../helpers/api.js';
import { kindsRegistry } from '../../src/kinds/_registry.js';
import { itemPage, refreshItem } from '../../src/services/itemPage.js';

/** Inside EDITED_NEW's edit window (it closes 2026-10-14T00:00Z). */
const DURING = new Date('2026-10-13T13:00:00.000Z');

/** @type {any} */
let deps;
/** @type {Record<string, number>} */
let calls;
/** @type {number} */
let itemId;
let clock = DURING.getTime();
before(async () => {
  const patched = patchedFetch((_kind, _id, json) => json);
  calls = patched.calls;
  deps = await ingestDeps();
  itemId = /** @type {number} */ ((await ingest(deps, IDS.EDITED_NEW)).itemId);
  deps = { ...deps, fetchImpl: patched.fetchImpl, now: () => new Date(clock) };
});
after(async () => { await deps.db.end(); });

const PATH = `/api/item/translation/${IDS.EDITED_NEW}/refresh`;

test('a refresh fetches the post; a 2nd within 60 s is throttled and fetches nothing', async () => {
  const api = apiFor(deps);
  const first = await api.call('POST', PATH);
  assert.equal(first.status, 200, first.text);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.deepEqual(JSON.parse(first.text), { updated: 0, editOpenUntil: '2026-10-14T00:00:00.000Z' });
  const fetched = calls[IDS.EDITED_NEW];
  assert.ok(fetched > 0);

  clock += 30_000;
  const second = await api.call('POST', PATH);
  assert.equal(second.status, 200);
  assert.deepEqual(JSON.parse(second.text), { updated: 0, editOpenUntil: '2026-10-14T00:00:00.000Z', throttled: true });
  assert.equal(calls[IDS.EDITED_NEW], fetched, 'no source fetch while throttled');

  clock += 31_000;
  const third = await api.call('POST', PATH);
  assert.equal(JSON.parse(third.text).throttled, undefined);
  assert.ok(calls[IDS.EDITED_NEW] > fetched, 'fetched again after 60 s');
});

test('a foreign Origin, or none, is 403 and touches nothing', async () => {
  const api = apiFor(deps);
  const before = await rows(deps.db, 'select last_refreshed_at from item_sources where item_id = $1 order by id', [itemId]);
  clock += 120_000;
  assert.equal((await api.call('POST', PATH, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await api.call('POST', PATH, { origin: null })).status, 403);
  assert.deepEqual(await rows(deps.db, 'select last_refreshed_at from item_sources where item_id = $1 order by id', [itemId]), before);
});

test('unknown kind, unknown or hidden item: 404', async () => {
  const api = apiFor(deps);
  assert.equal((await api.call('POST', `/api/item/nope/${IDS.EDITED_NEW}/refresh`)).status, 404);
  assert.equal((await api.call('POST', `/api/item/translation/${IDS.LONG}/refresh`)).status, 404);
  await deps.db.transaction((/** @type {any} */ tx) => tx.query("update items set review_state = 'pending' where id = $1", [itemId]), SYSTEM);
  try {
    assert.equal((await api.call('POST', PATH)).status, 404);
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query("update items set review_state = 'published' where id = $1", [itemId]), SYSTEM);
  }
});

test('a finalized item returns 409 edit_window_closed', async () => {
  const api = apiFor(deps);
  await deps.db.transaction((/** @type {any} */ tx) => tx.query('update item_sources set edit_finalized_at = now() where item_id = $1', [itemId]), SYSTEM);
  clock += 120_000;
  const fetched = calls[IDS.EDITED_NEW];
  const res = await api.call('POST', PATH);
  assert.equal(res.status, 409);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(JSON.parse(res.text), { error: 'edit_window_closed' });
  assert.equal(calls[IDS.EDITED_NEW], fetched);
});

test('a kind without refresh: the item page never schedules one, and the refresh route is a 404', async () => {
  const { refresh, ...rest } = kindsRegistry.translation;
  assert.equal(typeof refresh, 'function', 'the translation kind defines refresh');
  const noRefresh = { ...deps, kinds: { translation: Object.freeze(rest) } };
  await deps.db.transaction((/** @type {any} */ tx) => tx.query('update item_sources set edit_finalized_at = null where item_id = $1', [itemId]), SYSTEM);
  clock = new Date('2026-10-21T00:00:00.000Z').getTime();
  const fetched = calls[IDS.EDITED_NEW];
  const page = await itemPage(noRefresh, 'translation', IDS.EDITED_NEW);
  assert.ok(page);
  assert.equal(page.refresh, null);
  assert.equal(page.view.editOpenUntil, null);
  assert.ok((await itemPage(deps, 'translation', IDS.EDITED_NEW))?.refresh, 'with refresh, the elapsed window schedules one');
  assert.equal(await refreshItem(noRefresh, 'translation', IDS.EDITED_NEW), null);
  const api = apiFor(noRefresh);
  assert.equal((await api.call('POST', PATH)).status, 404);
  assert.equal(calls[IDS.EDITED_NEW], fetched, 'nothing fetched');
});

test('an updated refresh hard-deletes the entry\'s own CDN page before it responds; the rest is invalidated after', async () => {
  const EDITED_TEXT = "☀️: can't wait to see everyone at the fanmeet next weekend!! (venue changed)";
  const own = await ingestDeps();
  try {
    const id = /** @type {number} */ ((await ingest(own, IDS.EDITED_NEW)).itemId);
    const { fetchImpl } = patchedFetch((kind, sid, json) => {
      if (sid !== IDS.EDITED_NEW) return json;
      if (kind === 'syn') return { ...json, text: EDITED_TEXT };
      if (kind === 'fx') return { ...json, status: { ...json.status, text: EDITED_TEXT } };
      return json;
    });
    /** @type {string[]} */
    const events = [];
    const api = apiFor({
      ...own, fetchImpl, now: () => DURING,
      // Slow on purpose: a deferred delete would not have finished by the response.
      dangerouslyDeleteByTag: async (/** @type {string[]} */ tags) => { await new Promise((r) => setTimeout(r, 20)); events.push(`delete ${tags.join(',')}`); },
      invalidateByTag: async (/** @type {string[]} */ tags) => { events.push(`invalidate ${tags.join(',')}`); },
    }, { env: { VERCEL: '1' } });
    const res = await api.call('POST', `/api/item/translation/${IDS.EDITED_NEW}/refresh`);
    assert.equal(res.status, 200, res.text);
    assert.equal(JSON.parse(res.text).updated, 1);
    assert.equal(events[0], `delete item:${id}`, 'the own page is gone before the button reloads it');
    await api.settle();
    assert.equal(events.length, 2);
    assert.match(events[1], /^invalidate /);
    assert.ok(!events[1].split(' ')[1].split(',').includes(`item:${id}`), 'the own tag is not invalidated again');
    assert.ok(events[1].split(' ')[1].split(',').includes('home'));
  } finally {
    await own.db.end();
  }
});
