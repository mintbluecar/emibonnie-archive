// @ts-check
/**
 * The generic privacy sweep: with a credited translator (tl_gamma) and a
 * non-credited clip account (clipper_one) opted out and a submitter
 * blocked, every registered route is called with representative params,
 * and no response body may name those accounts or carry the hidden
 * items' ids or text. The one allowed echo: `/api/account/:handle` for an
 * opted-out handle answers `{ account: { handle, optedOut: true } }` with
 * the handle that was asked for -- and nothing else.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from './helpers/fixtures.js';
import { seededDeps, ingest, rows, SYSTEM } from './helpers/ingest.js';
import { apiFor } from './helpers/api.js';
import { routes } from '../src/routes/index.js';
import { matchRoute } from '../src/http/router.js';

/** Strings no public response may contain (compared case-insensitively). */
const BANNED = [
  'tl_gamma', 'clipper_one',
  IDS.EVENT_B, 'I have something to tell you', 'always you <b>&amp;</b> me', 'always you \\u003cb\\u003e',
  IDS.EDITED_OLD, IDS.EDITED_NEW, 'fanmeet',
];
const OPTED_OUT = ['tl_gamma', 'clipper_one'];

/** @type {any} */
let deps;
before(async () => {
  deps = await seededDeps();
  await deps.db.transaction((/** @type {any} */ tx) => tx.query("insert into users (id, display_name) values ('member-b', 'b')"), SYSTEM);
  assert.equal((await ingest(deps, IDS.EDITED_OLD, { actor: 'member-b' })).status, 'added');
  await deps.db.transaction(async (/** @type {any} */ tx) => {
    await tx.query("update accounts set opted_out_at = now() where handle = any($1)", [OPTED_OUT]);
    await tx.query("update users set blocked_at = now() where id = 'member-b'");
  }, SYSTEM);
});
after(async () => { await deps.db.end(); });

/** Representative calls covering every route, built from what the database holds (hidden rows included). */
async function representativeCalls() {
  const slugs = (await rows(deps.db, 'select slug from events order by id')).map((r) => r.slug);
  const handles = (await rows(deps.db, 'select handle from accounts order by id')).map((r) => r.handle);
  const people = (await rows(deps.db, "select handle from accounts where platform = 'instagram' order by id")).map((r) => r.handle);
  const ids = [...Object.values(IDS), '1'];
  /** @type {[string, string][]} */
  const calls = [['GET', '/api/home'], ['GET', '/api/filters']];
  for (const slug of [...slugs, 'no-such-event']) calls.push(['GET', `/api/event/${slug}`], ['GET', `/api/meta/e/${slug}`]);
  for (const id of ids) {
    calls.push(
      ['GET', `/api/item/translation/${id}`], ['POST', `/api/item/translation/${id}/refresh`],
      ['GET', `/api/video/translation/${id}`], ['GET', `/api/meta/t/${id}`],
    );
  }
  for (const ig of [...people, 'nobody']) calls.push(['GET', `/api/person/${ig}`]);
  for (const handle of [...handles, 'nobody']) calls.push(['GET', `/api/account/${encodeURIComponent(handle)}`]);
  const searches = [
    '', '?limit=50', '?offset=5', '?q=tell%20you', '?q=fanmeet', '?q=tl_gamma', '?q=clipper', '?q=everyone',
    '?accountHandle=tl_gamma', '?accountHandle=clipper_one', '?eventSlug=solluna-happy-day-2026-10-19', '?placements=event,unsorted',
    '?kinds=translation&from=2026-01-01&to=2026-12-31', '?people=1,2,3&peopleMode=all', '?categories=1,2,3',
  ];
  for (const s of searches) calls.push(['GET', `/api/search${s}`]);
  return calls;
}

test('privacy sweep: no route leaks an opted-out account, a removed post or a blocked submitter\'s item', async () => {
  const api = apiFor(deps);
  const calls = await representativeCalls();
  /** @type {Set<unknown>} */
  const covered = new Set();
  /** @type {string[]} */
  const leaks = [];
  for (const [method, path] of calls) {
    const hit = matchRoute(routes, method, path.split('?')[0]);
    assert.ok(hit, `${method} ${path} matches a route`);
    covered.add(hit.route);
    const res = await api.call(method, path);
    await api.settle();
    assert.ok(res.status < 500, `${method} ${path}: ${res.status} ${res.text}`);
    const handle = /^\/api\/account\/(.+)$/.exec(path)?.[1];
    if (handle && OPTED_OUT.includes(decodeURIComponent(handle))) {
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.text), { account: { handle: decodeURIComponent(handle), optedOut: true } }, 'exactly the opted-out shape');
      continue;
    }
    const body = res.text.toLowerCase();
    for (const banned of BANNED) if (body.includes(banned.toLowerCase())) leaks.push(`${method} ${path} contains '${banned}'`);
  }
  assert.deepEqual(leaks, []);
  assert.deepEqual(routes.filter((r) => !covered.has(r)).map((r) => `${r.method} ${r.path}`), [], 'every registered route was called');
});

test('the hidden items answer exactly like missing ones', async () => {
  const api = apiFor(deps);
  for (const id of [IDS.EVENT_B, IDS.EDITED_NEW]) {
    const item = await api.call('GET', `/api/item/translation/${id}`);
    const missing = await api.call('GET', '/api/item/translation/1');
    assert.equal(item.status, 404);
    assert.equal(item.text, missing.text);
    const meta = await api.call('GET', `/api/meta/t/${id}`);
    assert.equal(meta.text, (await api.call('GET', '/api/meta/t/1')).text);
    assert.equal((await api.call('POST', `/api/item/translation/${id}/refresh`)).status, 404);
  }
  await api.settle();
});
