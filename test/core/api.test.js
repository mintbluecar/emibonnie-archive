// @ts-check
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { getJson, postJson, ApiError } from '../../public/js/core/api.js';

/** @param {string|URL} input @returns {URL} */
function asUrl(input) {
  return new URL(String(input), 'http://localhost');
}

test('getJson: resolves with the parsed JSON body on a 200, path and params only (no origin assumed)', async () => {
  mock.method(globalThis, 'fetch', async (/** @type {string} */ path) => {
    const url = asUrl(path);
    assert.equal(url.pathname, '/api/thing');
    assert.equal(url.searchParams.get('q'), 'hi');
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  try {
    const body = await getJson('/api/thing', { q: 'hi' });
    assert.deepEqual(body, { ok: true });
  } finally {
    mock.restoreAll();
  }
});

test('getJson: throws ApiError{status} on a non-OK response', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 404 }));
  try {
    await assert.rejects(() => getJson('/api/missing'), (/** @type {any} */ err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 404);
      return true;
    });
  } finally {
    mock.restoreAll();
  }
});

test('getJson: omits undefined/null params, and no params gives a bare path', async () => {
  mock.method(globalThis, 'fetch', async (/** @type {string} */ path) => {
    assert.equal(path, '/api/thing');
    return new Response('{}', { status: 200 });
  });
  try {
    await getJson('/api/thing', { a: undefined, b: null });
  } finally {
    mock.restoreAll();
  }
});

test('postJson: POSTs JSON to the exact path and resolves with the parsed body', async () => {
  mock.method(globalThis, 'fetch', async (/** @type {string} */ path, /** @type {any} */ init) => {
    assert.equal(path, '/api/me/name');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(init.body), { name: 'Nice Fan' });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  try {
    const body = await postJson('/api/me/name', { name: 'Nice Fan' });
    assert.deepEqual(body, { ok: true });
  } finally {
    mock.restoreAll();
  }
});

test('postJson: an error keeps its status and the server\'s JSON body (the reason)', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json(
    { error: 'bad_request', message: 'looks_like_handle' },
    { status: 400 },
  ));
  try {
    await assert.rejects(() => postJson('/api/me/name', { name: '@x' }), (/** @type {any} */ err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 400);
      assert.equal(err.body?.message, 'looks_like_handle');
      return true;
    });
  } finally {
    mock.restoreAll();
  }
});

test('postJson: a non-JSON error body leaves body null', async () => {
  mock.method(globalThis, 'fetch', async () => new Response('nope', { status: 500 }));
  try {
    await assert.rejects(() => postJson('/api/me/name', {}), (/** @type {any} */ err) => {
      assert.ok(err instanceof ApiError);
      assert.equal(err.status, 500);
      assert.equal(err.body, null);
      return true;
    });
  } finally {
    mock.restoreAll();
  }
});
