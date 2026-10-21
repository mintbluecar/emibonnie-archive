// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTweetId, extractTweetIds } from '../../src/sources/url.js';

test('parseTweetId: bare id', () => {
  assert.equal(parseTweetId('1900000000000000001'), '1900000000000000001');
});

test('parseTweetId: x.com, twitter.com and mobile status URLs', () => {
  assert.equal(parseTweetId('https://x.com/tl_alpha/status/1900000000000000001'), '1900000000000000001');
  assert.equal(parseTweetId('https://twitter.com/tl_alpha/status/1900000000000000001'), '1900000000000000001');
  assert.equal(parseTweetId('https://mobile.twitter.com/tl_alpha/status/1900000000000000001'), '1900000000000000001');
  assert.equal(parseTweetId('https://mobile.x.com/tl_alpha/status/1900000000000000001'), '1900000000000000001');
});

test('parseTweetId: ?s= query strings and /video/1 suffixes', () => {
  assert.equal(parseTweetId('https://x.com/tl_alpha/status/1900000000000000001?s=20'), '1900000000000000001');
  assert.equal(parseTweetId('https://x.com/tl_alpha/status/1900000000000000001/video/1'), '1900000000000000001');
});

test('parseTweetId: a profile URL gives null', () => {
  assert.equal(parseTweetId('https://x.com/tl_alpha'), null);
});

test('parseTweetId: garbage gives null', () => {
  assert.equal(parseTweetId('123abc'), null);
});

test('extractTweetIds: preserves order and drops duplicates', () => {
  const text = [
    'first clip: https://x.com/tl_alpha/status/1900000000000000001',
    'second: https://x.com/tl_beta/status/1900000000000000002/video/1',
    'repeat of the first: https://twitter.com/tl_alpha/status/1900000000000000001?s=20',
  ].join('\n');

  assert.deepEqual(extractTweetIds(text), ['1900000000000000001', '1900000000000000002']);
});
