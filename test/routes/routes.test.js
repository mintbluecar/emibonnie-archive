// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { seededDeps, itemIdOf, rows, SYSTEM } from '../helpers/ingest.js';
import { apiFor } from '../helpers/api.js';
import { NotFound } from '../../src/http/errors.js';
import { PRIVATE_NO_STORE } from '../../src/http/handler.js';
import { routes } from '../../src/routes/index.js';
import { kindsRegistry } from '../../src/kinds/_registry.js';
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

/**
 * A route's returned body, whether it returned a plain value or its own
 * Response (the item route does, to set a per-request cache header).
 * @param {unknown} result
 * @returns {Promise<any>}
 */
async function bodyOf(result) {
  return result instanceof Response ? result.json() : result;
}

test('every route is { method, path, cache, run }, with a unique method+path', () => {
  // The original page paths of the meta routes: the event page, and each kind's item page.
  const pagePaths = ['/e/:slug', ...Object.values(kindsRegistry).map((kind) => `${kind.urlPrefix}:sourceId`)];
  assert.ok(pagePaths.includes('/t/:sourceId'));
  /** A cache value that guarantees the response is never stored. @param {string} cache */
  const neverStored = (cache) => cache === 'no-store' || cache === PRIVATE_NO_STORE;
  for (const r of routes) {
    assert.ok(['GET', 'POST'].includes(r.method), r.path);
    assert.ok(r.path.startsWith('/api/') || pagePaths.includes(r.path), `${r.path}: API paths, plus the original page paths of the meta routes`);
    assert.equal(typeof r.run, 'function');
    assert.ok(neverStored(r.cache) || r.cache === PUBLIC || r.cache === VIDEO, r.path);
    // Auth GETs (OAuth start/callback) and the signed-in user's own `/api/me`
    // (and `/api/me/added`) set cookies or depend on the session and must
    // never be cached, so they are no-store despite being GET; the add form's
    // `options` list is also per-user. Every other GET is cached, and every
    // write (POST) is no-store.
    const authGet = r.path.startsWith('/api/auth/') || r.path === '/api/me' || r.path === '/api/me/added' || r.path === '/api/me/translations' || r.path === '/api/owner' || r.path === '/api/owner/users'
      || r.path === '/api/add/options' || r.path === '/api/item/:kind/:sourceId/edit';
    assert.equal(neverStored(r.cache), r.method !== 'GET' || authGet, `${r.path}: GETs are cached, writes are no-store (auth flow excepted)`);
  }
  assert.equal(new Set(routes.map((r) => `${r.method} ${r.path}`)).size, routes.length);
});

test('event returns sections[0].kind', async () => {
  const view = await bodyOf(await eventRoute.run(input({ slug: SLUG }), routeDeps()));
  assert.equal(view.sections[0].kind, 'translation');
  await assert.rejects(eventRoute.run(input({ slug: 'no-such-event' }), routeDeps()), NotFound);
});

test('event: ?order=desc reverses the section; an unknown order is a BadRequest', async () => {
  const asc = await bodyOf(await eventRoute.run(input({ slug: SLUG }, { order: 'asc' }), routeDeps()));
  const desc = await bodyOf(await eventRoute.run(input({ slug: SLUG }, { order: 'desc' }), routeDeps()));
  assert.deepEqual(desc.sections[0].items.map((/** @type {any} */ i) => i.sourceId).reverse(), asc.sections[0].items.map((/** @type {any} */ i) => i.sourceId));
  await assert.rejects(eventRoute.run(input({ slug: SLUG }, { order: 'bogus' }), routeDeps()), { name: 'BadRequest' });
});

test('item: a removed item and an unknown kind throw NotFound', async () => {
  const view = await bodyOf(await itemRoute.run(input({ kind: 'translation', sourceId: IDS.EVENT_A }), routeDeps()));
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

test('video: given the outer item\'s own sourceId, resolves the quoted post\'s inner clip variants when the item\'s own media is a quote (review round 1, "quote card inner clip refetch")', async () => {
  // IDS.POST's media is a quote card whose quoted post (solsunny_x) currently
  // carries a picture; this swaps in a clip for just this test, to prove
  // GET /api/video/:kind/:sourceId -- addressed by the *outer* item's own
  // sourceId, exactly how videoPlayer.js's bind()/recover() call it for a
  // quote's inner clip -- resolves to the *quoted* post's variants, not a 404.
  const id = await itemIdOf(deps.db, IDS.POST);
  const before = await rows(deps.db, "select media from item_sources where item_id = $1 and role = 'quoted'", [id]);
  const innerVariants = [{ bitrate: 632000, url: 'https://video.twimg.com/amplify_video/innerv/pl/632000.mp4' }];
  const withVideo = { ...before[0].media, video: { variants: innerVariants, width: 720, height: 1280 } };
  await deps.db.transaction(
    (/** @type {any} */ tx) => tx.query("update item_sources set media = $1::jsonb where item_id = $2 and role = 'quoted'", [JSON.stringify(withVideo), id]),
    SYSTEM,
  );
  try {
    const { variants } = await videoRoute.run(input({ kind: 'translation', sourceId: IDS.POST }), routeDeps());
    assert.deepEqual(variants, innerVariants);
  } finally {
    await deps.db.transaction(
      (/** @type {any} */ tx) => tx.query("update item_sources set media = $1::jsonb where item_id = $2 and role = 'quoted'", [JSON.stringify(before[0].media), id]),
      SYSTEM,
    );
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
  const all = await bodyOf(await searchRoute.run(input({}, {}), routeDeps()));
  assert.ok(all.count > 0);
  const some = await bodyOf(await searchRoute.run(input({}, { kinds: ['translation'], q: 'everyone', limit: '2' }), routeDeps()));
  assert.equal(some.results.length, 2);
});

test('every public GET has s-maxage=300 (video 600), no Set-Cookie and no Vary: Cookie', async () => {
  const api = apiFor(deps);
  const paths = [
    '/api/home', `/api/event/${SLUG}`, `/api/item/translation/${IDS.LONG}`, '/api/search', '/api/search?q=everyone',
    '/api/filters', '/api/person/solsunny', '/api/account/tl_alpha', `/t/${IDS.LONG}`, `/e/${SLUG}`,
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

test('public GET 404s are cached for 60 s only', async () => {
  const api = apiFor(deps);
  for (const path of ['/api/event/no-such-event', '/api/item/translation/1', '/api/person/nobody', '/api/account/nobody', '/api/video/translation/1']) {
    const res = await api.call('GET', path);
    assert.equal(res.status, 404, path);
    assert.equal(res.headers.get('cache-control'), 'public, s-maxage=60', path);
  }
});

test('unknown query params on API GETs are a no-store 400; meta pages ignore tracking params', async () => {
  const api = apiFor(deps);
  for (const path of ['/api/home?x=1', `/api/event/${SLUG}?v=2`, '/api/filters?_=1', '/api/search?q=everyone&bogus=1', `/api/video/translation/${IDS.EVENT_A}?t=1`]) {
    const res = await api.call('GET', path);
    assert.equal(res.status, 400, path);
    assert.equal(res.headers.get('cache-control'), 'no-store', path);
  }
  assert.equal((await api.call('GET', '/api/search?q=everyone&limit=2&people=1,2&peopleMode=any')).status, 200);
  for (const path of [`/api/event/${SLUG}?limit=1&offset=1`, '/api/person/solsunny?limit=2', '/api/account/tl_alpha?offset=0', `/api/event/${SLUG}?order=desc`]) {
    assert.equal((await api.call('GET', path)).status, 200, path);
  }
  for (const path of [`/api/event/${SLUG}?limit=0`, '/api/person/solsunny?limit=51', '/api/account/tl_alpha?offset=x', `/api/event/${SLUG}?limit=1&limit=2`, `/api/event/${SLUG}?order=newest`]) {
    assert.equal((await api.call('GET', path)).status, 400, path);
  }
  assert.equal((await api.call('GET', `/t/${IDS.LONG}?s=20&utm_source=share`)).status, 200);
  assert.equal((await api.call('GET', `/e/${SLUG}?s=20`)).status, 200);
  // Task 10d: the event page's in-place search writes its state on the page's own URL, repeats included.
  assert.equal((await api.call('GET', `/e/${SLUG}?q=hug&people=1&people=2&scope=all`)).status, 200);
});

test('the meta routes answer on the page paths the function sees (/t/:id, /e/:slug); there is no /api/meta/*', async () => {
  const api = apiFor(deps);
  const item = await api.call('GET', `/t/${IDS.LONG}`);
  assert.equal(item.status, 200);
  assert.equal(item.headers.get('cache-control'), PUBLIC);
  assert.match(item.text, /og:title/);
  const event = await api.call('GET', `/e/${SLUG}`);
  assert.equal(event.status, 200);
  assert.match(event.text, /SOLLUNA HAPPY DAY/);
  assert.equal((await api.call('GET', `/api/meta/t/${IDS.LONG}`)).status, 404, 'the old rewritten path is gone');
  assert.equal((await api.call('GET', `/api/meta/e/${SLUG}`)).status, 404);
  assert.equal((await api.call('GET', `/zz/${IDS.LONG}`)).status, 404, 'only registered kind prefixes');
  assert.equal((await api.call('GET', `/t/${IDS.LONG}/extra`)).status, 404, 'one segment only');
  assert.equal((await api.call('GET', '/api/nope')).status, 404);
});

test('HEAD on a real route: the GET headers, an empty body', async () => {
  const api = apiFor(deps);
  const res = await api.call('HEAD', '/api/home');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), PUBLIC);
  assert.equal(res.text, '');
  const page = await api.call('HEAD', `/t/${IDS.LONG}`);
  assert.match(page.headers.get('content-type') ?? '', /^text\/html/);
  assert.equal(page.text, '');
});

test('a post with no edit window is finalized at intake, so viewing it never schedules a fetch', async () => {
  const id = await itemIdOf(deps.db, IDS.LONG);
  const open = await rows(deps.db, "select id from item_sources where item_id = $1 and editable_until is null and edit_finalized_at is null", [id]);
  assert.deepEqual(open, [], 'every no-window source of LONG is finalized');
  let fetches = 0;
  let defers = 0;
  const counting = { ...deps, fetchImpl: /** @type {typeof fetch} */ (async (...args) => { fetches += 1; return deps.fetchImpl(...args); }) };
  const view = await bodyOf(await itemRoute.run(input({ kind: 'translation', sourceId: IDS.LONG }), { ...counting, defer: () => { defers += 1; } }));
  assert.equal(view.editOpenUntil, null);
  assert.equal(defers, 0);
  assert.equal(fetches, 0);
});
