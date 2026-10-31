// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeDeps } from '../api/index.js';
import { dbOptionsFromEnv } from '../src/db/client.js';

test('in production (VERCEL set) a missing DATABASE_URL fails fast and never falls back to PGlite', () => {
  assert.throws(() => dbOptionsFromEnv({ VERCEL: '1' }), /DATABASE_URL is not set/);
  assert.throws(() => dbOptionsFromEnv({ VERCEL: '1', DATABASE_URL: '', PGLITE_DIR: '.devdb' }), /DATABASE_URL is not set/);
  assert.throws(() => makeDeps({ VERCEL: '1' }), /DATABASE_URL is not set/);
  assert.deepEqual(dbOptionsFromEnv({ VERCEL: '1', DATABASE_URL: 'postgres://u@h/d' }), { url: 'postgres://u@h/d' });
});

test('outside production the dev fallbacks stay available', async () => {
  assert.deepEqual(dbOptionsFromEnv({ PGLITE_DIR: '.devdb' }), { url: undefined, dir: '.devdb' });
  const deps = makeDeps({});
  try {
    assert.equal(typeof deps.db.query, 'function');
    assert.equal(typeof deps.now().getTime(), 'number');
  } finally {
    await deps.db.end();
  }
});

test('INGEST_FIXTURES_DIR: the e2e dev server reads sources from the synthetic fixtures, never the network', async () => {
  const deps = makeDeps({ INGEST_FIXTURES_DIR: 'test/fixtures/tweets' });
  try {
    const res = await deps.fetchImpl('https://cdn.syndication.twimg.com/tweet-result?id=1900000000000000017&lang=en');
    assert.equal(res.status, 200, 'a fixture the add-flow e2e pastes is served offline');
    assert.equal((await deps.fetchImpl('https://cdn.syndication.twimg.com/tweet-result?id=1&lang=en')).status, 404);
  } finally {
    await deps.db.end();
  }
  const prod = makeDeps({ VERCEL: '1', DATABASE_URL: 'postgres://u@h/d', INGEST_FIXTURES_DIR: 'test/fixtures/tweets' });
  try {
    assert.equal(prod.fetchImpl, globalThis.fetch, 'never on a deployment, even if the variable leaks in');
  } finally {
    await prod.db.end();
  }
});

test('routes see cookies and ip', async () => {
  const routes = /** @type {any} */ ([
    { method: 'GET', path: '/api/echo-ctx', cache: 'public, s-maxage=300', query: null,
      run: async (input) => ({ cookies: input.cookies, ip: input.ip }) },
  ]);
  const api = await (async () => {
    const { createHandler } = await import('../src/http/handler.js');
    const pending = [];
    const handle = createHandler({
      routes, makeDeps: () => ({ db: { end: async () => {} }, fetchImpl: fetch, now: () => new Date(), site: {} }),
      env: {},
      waitUntil: (p) => { pending.push(p); },
    });
    return { call: async (method, path, headers) => {
      const res = await handle(new Request(`https://archive.example${path}`, { method, headers }));
      return { status: res.status, json: await res.json() };
    } };
  })();

  const saw = await api.call('GET', '/api/echo-ctx', { cookie: 'a=1; b=2', 'x-forwarded-for': '203.0.113.5, 10.0.0.1' });
  assert.deepEqual(saw.json, { cookies: { a: '1', b: '2' }, ip: '203.0.113.5' });

  // x-real-ip fallback
  const sawReal = await api.call('GET', '/api/echo-ctx', { 'x-real-ip': '198.51.100.7' });
  assert.equal(sawReal.json.ip, '198.51.100.7');

  // no headers -> null ip, empty cookies
  const sawNone = await api.call('GET', '/api/echo-ctx', {});
  assert.deepEqual(sawNone.json, { cookies: {}, ip: null });
});
