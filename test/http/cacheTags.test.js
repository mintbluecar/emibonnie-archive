// @ts-check
/**
 * Plan 2b Task 2: the cache-tag vocabulary and the response header that
 * carries it. Tags are what a purge names; every public page's response
 * must carry its own so `invalidateByTag` can reach it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOME_TAG, SEARCH_TAG, accountTag, eventTag, itemTag, personTag } from '../../src/domain/cacheTags.js';
import { withCacheTags } from '../../src/http/cacheTags.js';

test('tags are stable and lower-case where they name a string', () => {
  assert.equal(HOME_TAG, 'home');
  assert.equal(SEARCH_TAG, 'search');
  assert.equal(itemTag(7), 'item:7');
  assert.equal(eventTag('an-event'), 'event:an-event');
  assert.equal(personTag(12), 'person:12');
  assert.equal(accountTag('LunaMoon'), 'account:lunamoon');
});

test('withCacheTags dedupes and sets one comma-separated header', () => {
  const res = withCacheTags(Response.json({}), ['home', 'home', itemTag(1)]);
  assert.equal(res.headers.get('vercel-cache-tag'), 'home,item:1');
  assert.equal(res.headers.get('cache-control'), null, 'the route still sets its own cache header');
});

test('withCacheTags leaves a response untouched when there is nothing to tag', () => {
  const res = withCacheTags(Response.json({}), []);
  assert.equal(res.headers.get('vercel-cache-tag'), null);
});
