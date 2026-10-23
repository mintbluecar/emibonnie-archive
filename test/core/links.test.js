// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { externalHref, hashtagHref } from '../../public/js/core/links.js';

test('externalHref (Task 10c): only https on an allowed host (x.com) passes', () => {
  assert.equal(externalHref('https://x.com/hashtag/a'), 'https://x.com/hashtag/a');
  assert.equal(externalHref('http://x.com/hashtag/a'), null);
  assert.equal(externalHref('https://evil.example/x.com'), null);
  assert.equal(externalHref('https://x.com.evil.example/'), null);
  assert.equal(externalHref('javascript:alert(1)'), null);
  assert.equal(externalHref('not a url'), null);
});

test('hashtagHref: X\'s hashtag search, the tag percent-encoded, a leading # dropped, empty refused', () => {
  assert.equal(hashtagHref('#SolLuna'), 'https://x.com/hashtag/SolLuna');
  assert.equal(hashtagHref('a/b?c'), 'https://x.com/hashtag/a%2Fb%3Fc');
  assert.equal(hashtagHref('#'), null);
});
