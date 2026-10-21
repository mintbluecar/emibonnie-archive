// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchTweet } from '../../src/sources/fetchTweet.js';
import { BadRequest } from '../../src/sources/errors.js';
import { IDS, fixtureDeps, fixtureDepsFailing } from '../helpers/fixtures.js';

test('fetchTweet: rejects a non-id before any fetch', async () => {
  let fetchCalled = false;
  const deps = { fetchImpl: /** @type {typeof fetch} */ (async () => {
    fetchCalled = true;
    throw new Error('should not be called');
  }) };

  await assert.rejects(() => fetchTweet(deps, '../etc'), BadRequest);
  assert.equal(fetchCalled, false);
});

test('fetchTweet: if fx fails, the tweet is still live', async () => {
  const deps = fixtureDepsFailing(['api.fxtwitter.com']);
  const tweet = await fetchTweet(deps, IDS.EVENT_A);
  assert.equal(tweet.status, 'live');
  assert.equal(tweet.textSource, 'syndication');
});

test('fetchTweet: a source that redirects is treated as null, the other still answers', async () => {
  const deps = fixtureDepsFailing(['cdn.syndication.twimg.com']);
  const tweet = await fetchTweet(deps, IDS.EVENT_A);
  assert.equal(tweet.status, 'live');
  assert.equal(tweet.textSource, 'fx');
});

test('fetchTweet: THREAD carries followUps from fetchThread', async () => {
  const deps = fixtureDeps();
  const tweet = await fetchTweet(deps, IDS.THREAD);
  assert.deepEqual(tweet.followUps.map((f) => f.id), [IDS.THREAD_FOLLOWUP]);
  assert.ok(tweet.followUps[0].text.startsWith('The list in the pic:'));
});

test('fetchTweet: a stale edit refetches the latest version once, keeping all versionIds', async () => {
  const deps = fixtureDeps();
  const tweet = await fetchTweet(deps, IDS.EDITED_OLD);
  assert.equal(tweet.id, IDS.EDITED_NEW);
  assert.deepEqual(tweet.edit.versionIds, [IDS.EDITED_OLD, IDS.EDITED_NEW]);
  assert.equal(tweet.edit.isStale, false);
  assert.ok(tweet.text.includes('next weekend'));
});
