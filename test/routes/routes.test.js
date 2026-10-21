// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { seededDeps, itemIdOf, rows, SYSTEM } from '../helpers/ingest.js';
import { apiFor } from '../helpers/api.js';
import { NotFound } from '../../src/http/errors.js';
import { routes } from '../../src/routes/index.js';
import { route as eventRoute } from '../../src/routes/event.js';
import { route as itemRoute } from '../../src/routes/item.js';
import { route as videoRoute } from '../../src/routes/video.js';
import { route as filtersRoute } from '../../src/routes/filters.js';
import { route as searchRoute } from '../../src/routes/search.js';

const PUBLIC = 'public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400';
const VIDEO = 'public, s-maxage=600, stale-while-revalidate=86400, stale-if-error=86400';
const SLUG = 'solluna-happy-day-2026-10-19';

/** @type {any} */
let deps;
before(async () => { deps = await seededDeps(); });
after(async () => { await deps.db.end(); });

/** @param {Record<string, string>} params @param {Record<string, unknown>} [query] */
const input = (params, query = {}) => ({ params, query, body: undefined, origin: 'https://archive.example' });
/** Route deps with a no-op `defer` (run-level tests don't need background work). */
const routeDeps = () => ({ ...deps, defer: () => {} });

test('every route is { method, path, cache, run }, with a unique method+path', () => {
  for (const r of routes) {
    assert.ok(['GET', 'POST'].includes(r.method), r.path);
    assert.match(r.path, /^\/api\//);
    assert.equal(typeof r.run, 'function');
    assert.ok(r.cache === 'no-store' || r.cache === PUBLIC || r.cache === VIDEO, r.path);
    assert.equal(r.cache === 'no-store', r.method !== 'GET', `${r.path}: GETs are cached, writes are no-store`);
  }
  assert.equal(new Set(routes.map((r) => `${r.method} ${r.path}`)).size, routes.length);
});

test('event returns sections[0].kind', async () => {
  const view = await eventRoute.run(input({ slug: SLUG }), routeDeps());
  assert.equal(view.sections[0].kind, 'translation');
  await assert.rejects(eventRoute.run(input({ slug: 'no-such-event' }), routeDeps()), NotFound);
});

test('item: a removed item and an unknown kind throw NotFound', async () => {
  const view = await itemRoute.run(input({ kind: 'translation', sourceId: IDS.EVENT_A }), routeDeps());
  assert.equal(view.sourceId, IDS.EVENT_A);
  assert.ok('editOpenUntil' in view);
  await assert.rejects(itemRoute.run(input({ kind: 'no_such_kind', sourceId: IDS.EVENT_A }), routeDeps()), NotFound);
  await assert.rejects(itemRoute.run(input({ kind: '__proto__', sourceId: IDS.EVENT_A }), routeDeps()), NotFound);
  const id = await itemIdOf(deps.db, IDS.EVENT_B);
  await deps.db.transaction((/** @type {any} */ tx) => tx.query("update items set deleted_at = now(), deleted_reason = 'spam' where id = $1", [id]), SYSTEM);
  try {
    await assert.rejects(itemRoute.run(input({ kind: 'translation', sourceId: IDS.EVENT_B }), routeDeps()), NotFound);
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query('update items set deleted_at = null, deleted_reason = null where id = $1', [id]), SYSTEM);
  }
});

test('video: stored variants of a visible item with a live clip; TOMB and items without video throw NotFound', async () => {
  const { variants } = await videoRoute.run(input({ kind: 'translation', sourceId: IDS.EVENT_A }), routeDeps());
  assert.ok(variants.length > 0);
  for (const v of variants) assert.match(v.url, /^https:\/\/video\.twimg\.com\//);
  await assert.rejects(videoRoute.run(input({ kind: 'translation', sourceId: IDS.TOMB }), routeDeps()), NotFound);
  await assert.rejects(videoRoute.run(input({ kind: 'translation', sourceId: IDS.EVENT_B }), routeDeps()), NotFound);
  await assert.rejects(videoRoute.run(input({ kind: 'nope', sourceId: IDS.EVENT_A }), routeDeps()), NotFound);
  const id = await itemIdOf(deps.db, IDS.EVENT_A);
  await deps.db.transaction((/** @type {any} */ tx) => tx.query("update item_sources set status = 'deleted' where item_id = $1 and role = 'media'", [id]), SYSTEM);
  try {
    await assert.rejects(videoRoute.run(input({ kind: 'translation', sourceId: IDS.EVENT_A }), routeDeps()), NotFound, 'the clip is gone');
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query("update item_sources set status = 'live' where item_id = $1 and role = 'media'", [id]), SYSTEM);
  }
});

test('filters lists only visible accounts', async () => {
  await deps.db.transaction((/** @type {any} */ tx) => tx.query("update accounts set opted_out_at = now() where handle = 'tl_gamma'"), SYSTEM);
  try {
    const view = await filtersRoute.run(input({}), routeDeps());
    assert.deepEqual(view.accounts, [{ handle: 'tl_alpha' }, { handle: 'tl_beta' }]);
  } finally {
    await deps.db.transaction((/** @type {any} */ tx) => tx.query("update accounts set opted_out_at = null where handle = 'tl_gamma'"), SYSTEM);
  }
});

test('search passes list params through as lists', async () => {
  const all = await searchRoute.run(input({}, {}), routeDeps());
  assert.ok(all.count > 0);
  const some = await searchRoute.run(input({}, { kinds: ['translation'], q: 'everyone', limit: '2' }), routeDeps());
  assert.equal(some.results.length, 2);
});

test('every public GET has s-maxage=300 (video 600), no Set-Cookie and no Vary: Cookie', async () => {
  const api = apiFor(deps);
  const paths = [
    '/api/home', `/api/event/${SLUG}`, `/api/item/translation/${IDS.LONG}`, '/api/search', '/api/search?q=everyone',
    '/api/filters', '/api/person/solsunny', '/api/account/tl_alpha', `/api/meta/t/${IDS.LONG}`, `/api/meta/e/${SLUG}`,
  ];
  for (const path of paths) {
    const res = await api.call('GET', path);
    assert.equal(res.status, 200, `${path}: ${res.text}`);
    assert.equal(res.headers.get('cache-control'), PUBLIC, path);
    assert.equal(res.headers.get('set-cookie'), null, path);
    assert.ok(!/cookie/i.test(res.headers.get('vary') ?? ''), path);
  }
  const video = await api.call('GET', `/api/video/translation/${IDS.EVENT_A}`);
  assert.equal(video.status, 200);
  assert.equal(video.headers.get('cache-control'), VIDEO);
  await api.settle();
});

test('the item GET refreshes an elapsed, unfinalized edit window in the background, without delaying the response', async () => {
  const id = await itemIdOf(deps.db, IDS.PHOTO);
  await deps.db.transaction((/** @type {any} */ tx) => tx.query(
    "update item_sources set editable_until = '2026-10-01T00:00:00Z', edit_finalized_at = null, last_refreshed_at = null where item_id = $1", [id],
  ), SYSTEM);
  const api = apiFor(deps);
  const res = await api.call('GET', `/api/item/translation/${IDS.PHOTO}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), PUBLIC, 'the CDN still caches it');
  assert.equal(JSON.parse(res.text).editOpenUntil, '2026-10-01T00:00:00.000Z');
  assert.equal(api.pending.length, 1, 'one background task');
  await api.settle();
  const open = await rows(deps.db, "select id from item_sources where item_id = $1 and role in ('primary','follow_up') and edit_finalized_at is null", [id]);
  assert.deepEqual(open, [], 'the refresh finalized the closed window');
  const audit = await rows(deps.db, "select actor from audit_log where table_name = 'item_sources' and row_key = $1 and changes ? 'edit_finalized_at' order by id desc limit 1", [String(id)]);
  assert.equal(audit[0].actor, 'system');

  const again = await api.call('GET', `/api/item/translation/${IDS.PHOTO}`);
  assert.equal(JSON.parse(again.text).editOpenUntil, null);
  assert.equal(api.pending.length, 0, 'nothing to refresh once finalized');
});
