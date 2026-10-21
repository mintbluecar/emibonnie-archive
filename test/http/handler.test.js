// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHandler, PUBLIC_CACHE, NO_STORE, NOT_FOUND_CACHE } from '../../src/http/handler.js';
import { BadRequest, NotFound, Conflict, RateLimited } from '../../src/http/errors.js';
import { originAllowed } from '../../src/http/origin.js';
import { parseQuery } from '../../src/http/query.js';

const BASE = 'https://archive.example';

/** Fake deps: counts `db.end()` calls. */
function fakeDeps() {
  const state = { ended: 0, made: 0 };
  const makeDeps = () => {
    state.made += 1;
    return { db: { end: async () => { state.ended += 1; } }, fetchImpl: fetch, now: () => new Date(), site: /** @type {any} */ ({}) };
  };
  return { state, makeDeps: /** @type {any} */ (makeDeps) };
}

/** @param {any[]} routes @param {{ log?: (line: string) => void, env?: Record<string, string>, waitUntil?: (p: Promise<unknown>) => void }} [options] */
function handlerFor(routes, options = {}) {
  const { state, makeDeps } = fakeDeps();
  const handle = createHandler({ routes, makeDeps, log: options.log ?? (() => {}), env: options.env ?? {}, waitUntil: options.waitUntil ?? ((p) => { p.catch(() => {}); }) });
  return { handle, state };
}

const echo = { method: 'GET', path: '/api/echo/:id', cache: PUBLIC_CACHE, query: ['x', 'tags'], lists: ['tags'], run: async (/** @type {any} */ input) => ({ params: input.params, query: input.query }) };
const write = { method: 'POST', path: '/api/write', cache: NO_STORE, run: async (/** @type {any} */ input) => ({ ok: true, body: input.body ?? null }) };

test('a POST with a foreign Origin, or none, is 403; same-origin and ALLOWED_ORIGINS pass', async () => {
  const { handle, state } = handlerFor([write], { env: { ALLOWED_ORIGINS: 'https://preview.example, https://other.example' } });
  const post = (/** @type {Record<string,string>} */ headers) => handle(new Request(`${BASE}/api/write`, { method: 'POST', headers }));
  const foreign = await post({ origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get('cache-control'), NO_STORE);
  assert.equal((await post({})).status, 403);
  assert.equal((await post({ origin: 'null' })).status, 403);
  assert.equal(state.made, 0, 'no deps (no database) are built for a refused write');
  assert.equal((await post({ origin: BASE })).status, 200);
  assert.equal((await post({ origin: 'https://other.example' })).status, 200);
  const sent = await handle(new Request(`${BASE}/api/write`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: '{"a":1}' }));
  assert.deepEqual(await sent.json(), { ok: true, body: { a: 1 } });
  const bad = await handle(new Request(`${BASE}/api/write`, { method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: '{' }));
  assert.equal(bad.status, 400);
});

test('originAllowed: exact origin match only', () => {
  const req = (/** @type {string} */ origin) => new Request(`${BASE}/api/x`, { method: 'POST', headers: { origin } });
  assert.equal(originAllowed(req(BASE), {}), true);
  assert.equal(originAllowed(req(`${BASE}.evil.example`), {}), false);
  assert.equal(originAllowed(req('http://archive.example'), {}), false);
  assert.equal(originAllowed(req('https://a.example'), { ALLOWED_ORIGINS: 'https://a.example.evil' }), false);
});

test('a public GET gets the route cache header, JSON, params and query, and no Set-Cookie', async () => {
  const { handle, state } = handlerFor([echo]);
  const res = await handle(new Request(`${BASE}/api/echo/a%20b?x=1&tags=a,b&tags=c`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400');
  assert.equal(res.headers.get('set-cookie'), null);
  assert.equal(res.headers.get('vary'), null);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await res.json(), { params: { id: 'a b' }, query: { x: '1', tags: ['a', 'b', 'c'] } });
  assert.equal(state.ended, 1, 'db.end() once per request');
});

test('errors map to 404, 400, 409, 429; unknown paths are 404; bad encodings are 400', async () => {
  const thrower = (/** @type {string} */ path, /** @type {() => Error} */ make) => ({ method: 'GET', path, cache: PUBLIC_CACHE, run: async () => { throw make(); } });
  const { handle, state } = handlerFor([
    thrower('/api/nf', () => new NotFound()), thrower('/api/br', () => new BadRequest('q is not valid')),
    thrower('/api/cf', () => new Conflict('edit_window_closed')), thrower('/api/rl', () => new RateLimited()), echo,
  ]);
  const get = async (/** @type {string} */ path) => handle(new Request(`${BASE}${path}`));
  const nf = await get('/api/nf');
  assert.equal(nf.status, 404);
  assert.equal(nf.headers.get('cache-control'), 'public, s-maxage=60');
  assert.equal(NOT_FOUND_CACHE, 'public, s-maxage=60');
  assert.deepEqual(await nf.json(), { error: 'not_found' });
  const br = await get('/api/br');
  assert.equal(br.status, 400);
  assert.equal(br.headers.get('cache-control'), NO_STORE);
  assert.deepEqual(await br.json(), { error: 'bad_request', message: 'q is not valid' });
  const cf = await get('/api/cf');
  assert.equal(cf.status, 409);
  assert.deepEqual(await cf.json(), { error: 'edit_window_closed' });
  assert.equal((await get('/api/rl')).status, 429);
  assert.equal((await get('/api/nope')).status, 404);
  assert.equal((await get('/api/echo/%E0%A4%A')).status, 400);
  assert.equal((await get('/api/echo/x?x=1&x=2')).status, 400, 'a repeated single-value param');
  assert.equal(state.ended, 4, 'db.end() even when the route throws (and no deps for unmatched or malformed requests)');
});

test('a thrown error is a 500 whose log line has no request headers', async () => {
  /** @type {string[]} */
  const lines = [];
  const boom = { method: 'GET', path: '/api/boom', cache: PUBLIC_CACHE, query: ['token'], run: async () => { throw new Error('kaboom'); } };
  const { handle, state } = handlerFor([boom], { log: (line) => lines.push(line) });
  const res = await handle(new Request(`${BASE}/api/boom?token=abc`, {
    headers: { cookie: 'session=SECRET_COOKIE_VALUE', authorization: 'Bearer SECRET_TOKEN_VALUE' },
  }));
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('cache-control'), NO_STORE);
  assert.deepEqual(await res.json(), { error: 'internal' });
  const logged = lines.join('\n');
  assert.match(logged, /kaboom/);
  assert.match(logged, /\/api\/boom/);
  for (const banned of ['cookie', 'authorization', 'SECRET_COOKIE_VALUE', 'SECRET_TOKEN_VALUE', 'token=abc']) {
    assert.ok(!logged.toLowerCase().includes(banned.toLowerCase()), banned);
  }
  assert.equal(state.ended, 1);
});

test('deferred work runs through waitUntil, and the database closes only after it settles', async () => {
  /** @type {Promise<unknown>[]} */
  const waited = [];
  /** @type {(v?: unknown) => void} */
  let release = () => {};
  const gate = new Promise((resolve) => { release = resolve; });
  const bg = {
    method: 'GET', path: '/api/bg', cache: PUBLIC_CACHE,
    run: async (/** @type {any} */ _input, /** @type {any} */ deps) => { deps.defer(() => gate); return { ok: true }; },
  };
  const { handle, state } = handlerFor([bg], { waitUntil: (p) => waited.push(p) });
  const res = await handle(new Request(`${BASE}/api/bg`));
  assert.equal(res.status, 200, 'the response does not wait for deferred work');
  assert.equal(waited.length, 1);
  assert.equal(state.ended, 0, 'the database stays open for the deferred work');
  release();
  await Promise.all(waited);
  assert.equal(state.ended, 1);
});

test('a failing deferred task is logged without headers and still closes the database', async () => {
  /** @type {string[]} */
  const lines = [];
  /** @type {Promise<unknown>[]} */
  const waited = [];
  const bg = {
    method: 'GET', path: '/api/bg', cache: PUBLIC_CACHE,
    run: async (/** @type {any} */ _input, /** @type {any} */ deps) => { deps.defer(async () => { throw new Error('bg failed'); }); return {}; },
  };
  const { handle, state } = handlerFor([bg], { log: (l) => lines.push(l), waitUntil: (p) => waited.push(p) });
  await handle(new Request(`${BASE}/api/bg`, { headers: { cookie: 'c=1' } }));
  await Promise.all(waited);
  assert.match(lines.join('\n'), /bg failed/);
  assert.ok(!lines.join('\n').toLowerCase().includes('cookie'));
  assert.equal(state.ended, 1);
});

test('parseQuery: lists split on commas and repeat; other params are single; no prototype keys', () => {
  const q = parseQuery(new URLSearchParams('a=1&people=1,2&people=3&kinds=&__proto__=x'), ['people', 'kinds']);
  assert.equal(q.a, '1');
  assert.deepEqual(q.people, ['1', '2', '3']);
  assert.equal(Object.hasOwn(q, 'kinds'), false, 'an empty list is left out');
  assert.equal(Object.getOwnPropertyDescriptor(q, '__proto__')?.value, 'x', 'an own key, not a prototype');
  assert.equal(Object.getPrototypeOf(q), null);
  assert.throws(() => parseQuery(new URLSearchParams('a=1&a=2'), []), BadRequest);
});

test('HEAD runs the matching GET route and returns its headers with an empty body', async () => {
  const { handle, state } = handlerFor([echo, write]);
  const res = await handle(new Request(`${BASE}/api/echo/a?x=1`, { method: 'HEAD' }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), PUBLIC_CACHE);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(await res.text(), '');
  assert.equal(state.ended, 1);
  assert.equal((await handle(new Request(`${BASE}/api/write`, { method: 'HEAD' }))).status, 404, 'HEAD never reaches a write');
  const missing = await handle(new Request(`${BASE}/api/nope`, { method: 'HEAD' }));
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), '');
});

test('a body over 16 KB is 413 while streaming, with or without content-length', async () => {
  const { handle } = handlerFor([write]);
  const chunk = new TextEncoder().encode(`"${'x'.repeat(4000)}`);
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled += 1;
      if (pulled > 100) controller.close();
      else controller.enqueue(chunk);
    },
  });
  const chunked = await handle(new Request(`${BASE}/api/write`, {
    method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: stream, duplex: 'half',
  }));
  assert.equal(chunked.status, 413);
  assert.equal(chunked.headers.get('cache-control'), NO_STORE);
  assert.deepEqual(await chunked.json(), { error: 'payload_too_large' });
  assert.ok(pulled < 10, `stopped reading early (${pulled} chunks)`);
  const declared = await handle(new Request(`${BASE}/api/write`, {
    method: 'POST', headers: { origin: BASE, 'content-type': 'application/json', 'content-length': '20000' }, body: '{}',
  }));
  assert.equal(declared.status, 413);
  const multibyte = await handle(new Request(`${BASE}/api/write`, {
    method: 'POST', headers: { origin: BASE, 'content-type': 'application/json' }, body: JSON.stringify('ก'.repeat(6000)),
  }));
  assert.equal(multibyte.status, 413, 'counted in bytes, not characters');
});

test('an unknown query param on a GET route is a no-store 400; a route may accept any', async () => {
  const anyQuery = { method: 'GET', path: '/api/any', cache: PUBLIC_CACHE, query: null, run: async () => ({ ok: true }) };
  const none = { method: 'GET', path: '/api/none', cache: PUBLIC_CACHE, run: async () => ({ ok: true }) };
  const { handle, state } = handlerFor([echo, anyQuery, none]);
  const bad = await handle(new Request(`${BASE}/api/echo/a?x=1&cachebust=2`));
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get('cache-control'), NO_STORE);
  assert.deepEqual(await bad.json(), { error: 'bad_request', message: 'unknown query parameter: cachebust' });
  assert.equal((await handle(new Request(`${BASE}/api/none?a=1`))).status, 400, 'no declared params: none allowed');
  assert.equal((await handle(new Request(`${BASE}/api/none`))).status, 200);
  assert.equal((await handle(new Request(`${BASE}/api/any?s=20&utm_source=x`))).status, 200);
  assert.equal(state.ended, 2, 'refused before any deps are built');
});
