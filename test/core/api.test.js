// @ts-check
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { getJson, ApiError } from '../../public/js/core/api.js';

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
