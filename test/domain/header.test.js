// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHeader } from '../../src/domain/header.js';
import { LIVE_PATTERNS } from '../../src/domain/constants.js';
import { IDS, loadRaw } from '../helpers/fixtures.js';

const PERSON_HANDLES = ['solsunny', 'lunamoon'];
const IGNORED_HASHTAGS = ['solluna'];

/** @param {string} id */
function fxText(id) {
  return loadRaw(id).fx.status.text;
}

/** @param {string} text */
function header(text, extra = {}) {
  return parseHeader(text, {
    ignoredHashtags: IGNORED_HASHTAGS,
    personHandles: PERSON_HANDLES,
    livePatterns: LIVE_PATTERNS,
    ...extra,
  });
}

test('EVENT_A: keyword and hashtag', () => {
  const result = header(fxText(IDS.EVENT_A));
  assert.equal(result.keyword, 'SOLLUNA HAPPY DAY');
  assert.ok(result.hashtags.includes('slhappyday2026'));
});

test('EVENT_B: drops the ignored #SolLuna', () => {
  const result = header(fxText(IDS.EVENT_B));
  assert.ok(result.hashtags.includes('slhappyday2026'));
  assert.ok(!result.hashtags.includes('solluna'));
  assert.ok(!result.personTags.includes('solluna'));
  assert.ok(!result.unknownHandleTags.includes('solluna'));
});

test('LIVE: personTags and a tiktok live date from [YYMMDD]', () => {
  const result = header(fxText(IDS.LIVE));
  assert.deepEqual(result.personTags, ['lunamoon']);
  assert.deepEqual(result.live, { code: 'tiktok live', platformCode: 'tiktok', date: '2026-02-12' });
});

test('JOINT_LIVE: both personTags and the ig live code', () => {
  const result = header(fxText(IDS.JOINT_LIVE));
  assert.deepEqual(result.personTags, ['solsunny', 'lunamoon']);
  assert.equal(result.live?.code, 'ig live');
});

test('SHARED: an unrecognised plain handle is an unknownHandleTag', () => {
  const result = header(fxText(IDS.SHARED));
  assert.deepEqual(result.unknownHandleTags, ['starguest']);
});

test("a site's extraLivePatterns, compiled and appended by the caller, are detected", () => {
  const withExtra = [...LIVE_PATTERNS, { code: 'weverse live', platformCode: 'weverse', pattern: /weverse\s*live/i }];
  const result = header('Weverse Live [260101]\n\n🦁: hi', { livePatterns: withExtra });
  assert.deepEqual(result.live, { code: 'weverse live', platformCode: 'weverse', date: '2026-01-01' });
});

test("a bare 'd/m' live date is resolved using postedAt's local year, written as given", () => {
  const result = header('luna tiktok live 12/2', {
    postedAt: '2026-02-12T17:30:00Z',
    timezone: 'Asia/Bangkok',
  });
  assert.equal(result.live?.date, '2026-02-12');
});

test('a bare d/m live date with no postedAt is left null rather than reading the clock', () => {
  const result = header('luna tiktok live 12/2');
  assert.equal(result.live?.date, null);
});

test('context carries a leftover header line that is not the keyword, a hashtag line, or the live line', () => {
  const result = header('SOLLUNA HAPPY DAY\na note from the poster\n#SLHappyDay2026\n\n☀️: hi');
  assert.equal(result.context, 'a note from the poster');
});

test('no keyword, hashtag, or live match gives null/empty defaults', () => {
  const result = header('🦁: just a greeting, nothing else');
  assert.deepEqual(result, {
    keyword: null,
    hashtags: [],
    personTags: [],
    unknownHandleTags: [],
    live: null,
    context: null,
  });
});
