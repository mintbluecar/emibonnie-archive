// @ts-check
/** Plan 3: the import's backoff on 429/5xx (the CLI's own fetch guard). */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { retryingFetch, RETRY_DELAYS_MS } from '../../src/services/importFetch.js';

/** @param {number[]} statuses @returns {{ fetchImpl: typeof fetch, calls: () => number, sleeps: number[] }} */
function scripted(statuses) {
  const sleeps = [];
  let calls = 0;
  const fetchImpl = /** @type {typeof fetch} */ (async () => {
    const status = statuses[Math.min(calls, statuses.length - 1)];
    calls += 1;
    return new Response('', { status });
  });
  return {
    fetchImpl: retryingFetch(fetchImpl, { sleep: async (ms) => { sleeps.push(ms); } }),
    calls: () => calls,
    sleeps,
  };
}

test('a 429 and 5xx are retried after 1s, 2s and 4s, then the last response is returned', async () => {
  const script = scripted([429, 503, 500, 502]);
  const response = await script.fetchImpl('https://api.fxtwitter.com/2/status/1');
  assert.equal(response.status, 502);
  assert.equal(script.calls(), 4, 'the first attempt plus three retries');
  assert.deepEqual(script.sleeps, [...RETRY_DELAYS_MS]);
});

test('a retry that succeeds stops the backoff', async () => {
  const script = scripted([429, 200]);
  const response = await script.fetchImpl('https://api.fxtwitter.com/2/status/1');
  assert.equal(response.status, 200);
  assert.equal(script.calls(), 2);
  assert.deepEqual(script.sleeps, [1000]);
});

test('a 404 or a 200 is never retried', async () => {
  const missing = scripted([404]);
  assert.equal((await missing.fetchImpl('https://x/1')).status, 404);
  assert.equal(missing.calls(), 1);
  assert.deepEqual(missing.sleeps, []);

  const ok = scripted([200]);
  assert.equal((await ok.fetchImpl('https://x/1')).status, 200);
  assert.equal(ok.calls(), 1);
});
