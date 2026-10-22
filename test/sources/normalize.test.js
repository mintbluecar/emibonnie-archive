// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize } from '../../src/sources/normalize.js';
import { IDS, loadRaw } from '../helpers/fixtures.js';

test('LONG: text comes from fx, is long, and keeps the 🐱 line', () => {
  const tweet = normalize(IDS.LONG, loadRaw(IDS.LONG));
  assert.equal(tweet.textSource, 'fx');
  assert.ok(tweet.text.length >= 2400, `expected >= 2400 chars, got ${tweet.text.length}`);
  assert.ok(tweet.text.includes('🐱: We hug all the time.'));
  assert.ok(tweet.text.includes('ครบ'));
});

test('LONG: quotedId is set', () => {
  const tweet = normalize(IDS.LONG, loadRaw(IDS.LONG));
  assert.equal(tweet.quotedId, IDS.LONG_QUOTED);
  assert.equal(tweet.quoted?.id, IDS.LONG_QUOTED);
});

test('LONG: drops the mp4 variant on a non-twimg host', () => {
  const tweet = normalize(IDS.LONG, loadRaw(IDS.LONG));
  assert.ok(tweet.video);
  const bitrates = tweet.video.variants.map((v) => v.bitrate);
  assert.deepEqual(bitrates, [632000, 950000, 2176000, 10368000]);
  assert.ok(tweet.video.variants.every((v) => new URL(v.url).hostname === 'video.twimg.com'));
});

test('EVENT_A: clipSource is clipper_one', () => {
  const tweet = normalize(IDS.EVENT_A, loadRaw(IDS.EVENT_A));
  assert.equal(tweet.clipSource?.handle, 'clipper_one');
  assert.equal(tweet.clipSource?.url, 'https://x.com/clipper_one/status/1900000000000000091/video/1');
});

test('PHOTO: gives 2 images on pbs.twimg.com, dropping the non-pbs one', () => {
  const tweet = normalize(IDS.PHOTO, loadRaw(IDS.PHOTO));
  assert.equal(tweet.images.length, 2);
  assert.ok(tweet.images.every((img) => new URL(img.url).hostname === 'pbs.twimg.com'));
});

test('POST: quotes solsunny_x, whose text is the Thai sentence', () => {
  const tweet = normalize(IDS.POST, loadRaw(IDS.POST));
  assert.equal(tweet.quoted?.authorHandle, 'solsunny_x');
  assert.ok(tweet.quoted?.text.includes('คิดถึงเธอทุกวันเลยช่วงนี้'));
});

test('POST: quoted tweet carries its one photo', () => {
  const tweet = normalize(IDS.POST, loadRaw(IDS.POST));
  assert.equal(tweet.quoted?.images.length, 1);
  assert.equal(new URL(tweet.quoted.images[0].url).hostname, 'pbs.twimg.com');
});

test('video shape: width/height come from mediaDetails[0].original_info; LIVE is vertical', () => {
  const tweet = normalize(IDS.LIVE, loadRaw(IDS.LIVE));
  assert.equal(tweet.video?.width, 720);
  assert.equal(tweet.video?.height, 1280);
});

test('LIVE: text comes from syndication', () => {
  const tweet = normalize(IDS.LIVE, loadRaw(IDS.LIVE));
  assert.equal(tweet.textSource, 'syndication');
  assert.ok(tweet.text.startsWith('#lunamoon TikTok live [260212]'));
});

test('missing tweets: a tombstone is deleted, nothing at all is unavailable', () => {
  const tomb = normalize(IDS.TOMB, loadRaw(IDS.TOMB));
  assert.equal(tomb.status, 'deleted');

  const nothing = normalize('1900000000000000098', { syndication: null, fx: null });
  assert.equal(nothing.status, 'unavailable');
});

test('normalize: a tweet with no edit_control gives versionIds [ownId] and isStale false', () => {
  const tweet = normalize(IDS.EVENT_A, loadRaw(IDS.EVENT_A));
  assert.deepEqual(tweet.edit.versionIds, [IDS.EVENT_A]);
  assert.equal(tweet.edit.latestId, IDS.EVENT_A);
  assert.equal(tweet.edit.isStale, false);
});
