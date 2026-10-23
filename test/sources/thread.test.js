// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchThread } from '../../src/sources/thread.js';
import { IDS, fixtureDeps, fixtureDepsFailing } from '../helpers/fixtures.js';

test('fetchThread: returns only the same-author in-chain follow-up', async () => {
  const followUps = await fetchThread(fixtureDeps(), IDS.THREAD);
  assert.deepEqual(followUps.map((f) => f.id), [IDS.THREAD_FOLLOWUP]);
  assert.ok(!followUps.some((f) => f.id === IDS.THREAD_OTHER));
});

test('fetchThread: returns [] when the thread fetch fails', async () => {
  const followUps = await fetchThread(fixtureDepsFailing(['api.fxtwitter.com']), IDS.THREAD);
  assert.deepEqual(followUps, []);
});
