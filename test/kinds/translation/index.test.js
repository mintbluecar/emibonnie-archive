// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import translation from '../../../src/kinds/translation/index.js';
import { IDS, fixtureDeps } from '../../helpers/fixtures.js';

test('the translation kind: name, table, url prefix', () => {
  assert.equal(translation.name, 'translation');
  assert.equal(translation.table, 'translations');
  assert.equal(translation.urlPrefix, '/t/');
  assert.equal(translation.platform, 'x');
});

test('matchesUrl returns the tweet id, or null', () => {
  assert.equal(translation.matchesUrl(`https://x.com/tl_alpha/status/${IDS.LONG}`), IDS.LONG);
  assert.equal(translation.matchesUrl('https://example.com/'), null);
});

test('fetchSource fetches the tweet', async () => {
  const tweet = /** @type {any} */ (await translation.fetchSource(fixtureDeps(), IDS.EVENT_A));
  assert.equal(tweet.id, IDS.EVENT_A);
});

test('followUpOf: a reply gives the candidate parent ref; otherwise null', () => {
  assert.deepEqual(translation.followUpOf?.({ replyToId: IDS.THREAD }), { platform: 'x', externalId: IDS.THREAD });
  assert.equal(translation.followUpOf?.({ replyToId: null }), null);
});

test('present and search are implemented (behaviour: test/kinds/translation/presenter.test.js)', () => {
  assert.equal(typeof translation.appendFollowUp, 'function');
  assert.equal(typeof translation.present.preview, 'function');
  assert.match(translation.search.textClause(1), /translation_parts/);
});
