// @ts-check
/**
 * `defineRoute` (src/http/defineRoute.js): one place owns auth, rate limits,
 * body parsing and cache defaults. Exercised through the real route table
 * (`apiFor`), plus the definition-time checks called directly.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ingestDeps } from '../helpers/ingest.js';
import { apiFor } from '../helpers/api.js';
import { signInUser } from '../../src/services/session.js';
import { defineRoute } from '../../src/http/defineRoute.js';
import { PUBLIC_CACHE, PRIVATE_NO_STORE, createHandler } from '../../src/http/handler.js';
import { ownerRoute, approvalRoute, reviewRoute } from '../../src/routes/owner.js';
import { addedRoute, setNameRoute } from '../../src/routes/me.js';

/** @type {Awaited<ReturnType<typeof ingestDeps>>} */
let deps;
/** @type {ReturnType<typeof apiFor>} */
let api;

/** @param {string} subject @returns {Promise<string>} the sid of a fresh X sign-in */
async function sidFor(subject) {
  const { cookie } = await signInUser(deps, { via: 'x', subject, handle: `fan_${subject}` });
  return cookie.replace(/^sid=/, '').split(';')[0];
}

before(async () => {
  deps = await ingestDeps();
  api = apiFor(deps);
});
after(async () => { await deps.db.end(); });

test('owner routes answer 401 to a visitor and 403 to a member', async () => {
  assert.equal(ownerRoute.auth, 'owner');
  assert.equal(approvalRoute.auth, 'owner');
  const member = await sidFor('7770001');
  assert.equal((await api.call('GET', '/api/owner')).status, 401);
  assert.equal((await api.call('POST', '/api/owner/approval', { body: { required: true } })).status, 401);
  const forbidden = await api.call('GET', '/api/owner', { cookies: { sid: member } });
  assert.equal(forbidden.status, 403);
  assert.deepEqual(JSON.parse(forbidden.text), { error: 'forbidden' });
  assert.equal((await api.call('POST', '/api/owner/approval', { cookies: { sid: member }, body: { required: true } })).status, 403);
});

test('a limited route answers 429 after its limit', async () => {
  assert.equal(setNameRoute.auth, 'user');
  const sid = await sidFor('7770002');
  for (let i = 0; i < 5; i++) {
    const res = await api.call('POST', '/api/me/name', { cookies: { sid }, body: { name: `Fan ${i}` } });
    assert.equal(res.status, 200, res.text);
  }
  const limited = await api.call('POST', '/api/me/name', { cookies: { sid }, body: { name: 'Fan 6' } });
  assert.equal(limited.status, 429);
  assert.deepEqual(JSON.parse(limited.text), { error: 'rate_limited' });
});

test('an IP-keyed limit counts by IP even for a signed-in caller', async () => {
  const headers = { 'x-forwarded-for': '198.51.100.77' };
  const first = await sidFor('7770003');
  const second = await sidFor('7770004');
  // An empty report is a 400, but the limit is counted before the body is read.
  for (let i = 0; i < 5; i++) assert.equal((await api.call('POST', '/api/reports', { cookies: { sid: first }, headers, body: {} })).status, 400);
  assert.equal((await api.call('POST', '/api/reports', { cookies: { sid: second }, headers, body: {} })).status, 429);
});

test('a body parser\'s BadRequest becomes a 400', async () => {
  const owner = await sidFor(deps.site.ownerXUserId);
  const res = await api.call('POST', '/api/owner/items/translation/1/review', { cookies: { sid: owner }, body: { state: 'sure' } });
  assert.equal(res.status, 400);
  assert.deepEqual(JSON.parse(res.text), { error: 'bad_request', message: 'state must be published or rejected' });
  assert.equal(reviewRoute.auth, 'owner');
});

test('a signed-in GET defaults to private, no-store', async () => {
  assert.equal(addedRoute.cache, PRIVATE_NO_STORE);
  assert.equal(ownerRoute.cache, PRIVATE_NO_STORE);
  const sid = await sidFor('7770005');
  const res = await api.call('GET', '/api/me/added', { cookies: { sid } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.headers.get('cache-control'), PRIVATE_NO_STORE);
  const fake = defineRoute({ method: 'POST', path: '/api/x', auth: 'user', run: async () => ({}) });
  assert.equal(fake.cache, 'no-store', 'and a write defaults to no-store');
});

test('declaring PUBLIC_CACHE on an owner GET throws at definition', () => {
  const run = async () => ({});
  assert.throws(() => defineRoute({ method: 'GET', path: '/api/x', auth: 'owner', cache: PUBLIC_CACHE, run }), /public/i);
  assert.throws(() => defineRoute({ method: 'GET', path: '/api/x', auth: 'user', cache: PUBLIC_CACHE, run }), /public/i);
  assert.equal(defineRoute({ method: 'GET', path: '/api/x', auth: 'optional', cache: PUBLIC_CACHE, run }).cache, PUBLIC_CACHE);
});

test('a user-keyed limit needs a route that always has a user', () => {
  const run = async () => ({});
  assert.throws(() => defineRoute({ method: 'POST', path: '/api/x', auth: 'optional', limit: 'add', run }), /user/);
  assert.equal(defineRoute({ method: 'POST', path: '/api/x', auth: 'none', limit: 'signIn', run }).auth, 'none');
});

test('a route\'s auth is read-only', () => {
  const route = defineRoute({ method: 'POST', path: '/api/x', auth: 'owner', run: async () => ({}) });
  assert.throws(() => { /** @type {any} */ (route).auth = 'none'; }, TypeError);
});

test('the sign-in hint is added only to a private or no-store answer, never a publicly cacheable one', async () => {
  const sid = await sidFor('7770099');
  const shared = defineRoute({ method: 'GET', path: '/t/shared', auth: 'optional', cache: PUBLIC_CACHE, query: [], run: async () => ({ ok: true }) });
  const mine = defineRoute({ method: 'GET', path: '/t/mine', auth: 'optional', cache: PUBLIC_CACHE, query: [],
    run: async () => Response.json({ ok: true }, { headers: { 'cache-control': PRIVATE_NO_STORE } }) });
  const owner = defineRoute({ method: 'GET', path: '/t/owner', auth: 'user', query: [], run: async () => ({ ok: true }) });
  const handle = createHandler({
    routes: [shared, mine, owner], env: {}, log: (line) => { throw new Error(line); },
    makeDeps: (env) => ({ ...deps, db: { ...deps.db, end: async () => {} }, env }), waitUntil: () => {},
  });
  const get = (/** @type {string} */ path) => handle(new Request(`https://archive.example${path}`, { headers: { cookie: `sid=${sid}` } }));

  const pub = await get('/t/shared');
  assert.equal(pub.status, 200);
  assert.match(String(pub.headers.get('vercel-cdn-cache-control')), /s-maxage/, 'a CDN-cached answer');
  assert.deepEqual(pub.headers.getSetCookie(), [], 'a publicly cacheable answer never carries a Set-Cookie');

  const priv = await get('/t/mine');
  assert.equal(priv.headers.get('cache-control'), PRIVATE_NO_STORE);
  assert.deepEqual(priv.headers.getSetCookie().map((c) => c.split(';')[0]), ['signed_in=1']);

  const signedIn = await get('/t/owner');
  assert.equal(signedIn.headers.get('cache-control'), PRIVATE_NO_STORE);
  assert.deepEqual(signedIn.headers.getSetCookie().map((c) => c.split(';')[0]), ['signed_in=1']);
});
