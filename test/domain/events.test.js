// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchEvent, proposeEvent } from '../../src/domain/events.js';
import { parseHeader } from '../../src/domain/header.js';
import { LIVE_PATTERNS } from '../../src/domain/constants.js';

const SOL = 1;
const LUNA = 2;
const PEOPLE = [
  { id: SOL, displayName: 'Sol', igHandle: 'solsunny' },
  { id: LUNA, displayName: 'Luna', igHandle: 'lunamoon' },
];
const lower = (/** @type {string} */ name) => name.toLowerCase();

/**
 * @param {Partial<import('../../src/domain/events.js').Event>} fields
 * @returns {import('../../src/domain/events.js').Event}
 */
function event(fields) {
  return {
    id: 1,
    slug: 'e',
    name: 'e',
    occurredOn: '2026-02-12',
    categoryId: null,
    clientId: null,
    keywords: [],
    hashtags: [],
    livePeopleIds: [],
    livePlatformCode: null,
    ...fields,
  };
}

/** @param {string} text @param {string} [postedAt] */
function header(text, postedAt) {
  return parseHeader(`${text}\n\n☀️: hi`, {
    ignoredHashtags: ['solluna'],
    personHandles: ['solsunny', 'lunamoon'],
    livePatterns: LIVE_PATTERNS,
    postedAt,
    timezone: 'Asia/Bangkok',
  });
}

/**
 * @param {string} text
 * @param {{events?: any[], postedAt?: string, timezone?: string, postAuthorIds?: number[]}} [opts]
 */
function match(text, { events = [], postedAt = '2026-02-12T13:00:00Z', timezone = 'Asia/Bangkok', postAuthorIds } = {}) {
  return matchEvent({ header: header(text, postedAt), postedAt, events, people: PEOPLE, formatName: lower, timezone, postAuthorIds });
}

const HAPPY_DAY = event({ id: 10, keywords: ['SOLLUNA HAPPY DAY'], hashtags: ['slhappyday2026'], occurredOn: '2026-10-19' });

test('keyword matches with mixed case and spacing', () => {
  const result = match('SOLLUNA  HAPPY   Day', { events: [event({ id: 10, keywords: ['solluna happy day'] })] });
  assert.equal(result.placement, 'event');
  assert.equal(result.event?.id, 10);
  assert.equal(result.proposal, null);
});

test('a hashtag matches by norm', () => {
  const result = match('#SLHappyDay2026', { events: [HAPPY_DAY] });
  assert.equal(result.event?.id, 10);
});

test('a lowercase event hashtag (an unknown handle tag) matches an existing event first', () => {
  const result = match('#slhappyday2026', { events: [HAPPY_DAY] });
  assert.equal(result.placement, 'event');
  assert.equal(result.event?.id, 10);
});

test('an empty header gives unsorted', () => {
  const result = match('');
  assert.equal(result.placement, 'unsorted');
  assert.equal(result.event, null);
  assert.equal(result.proposal, null);
});

const LUNA_TIKTOK = event({ id: 20, occurredOn: '2026-02-12', livePeopleIds: [LUNA], livePlatformCode: 'tiktok' });

test('a luna tiktok live within 1 day matches', () => {
  const result = match('#lunamoon TikTok live [260213]', { events: [LUNA_TIKTOK] });
  assert.equal(result.event?.id, 20);
});

test('a luna tiktok live 3 days away proposes a new event', () => {
  const result = match('#lunamoon TikTok live [260215]', { events: [LUNA_TIKTOK] });
  assert.equal(result.placement, 'event');
  assert.equal(result.event, null);
  assert.equal(result.proposal?.name, 'luna tiktok live');
  assert.equal(result.proposal?.slug, 'luna-tiktok-live-2026-02-15');
  assert.deepEqual(result.proposal?.livePeopleIds, [LUNA]);
});

test('a live on another platform does not match', () => {
  const result = match('#lunamoon IG live [260212]', { events: [LUNA_TIKTOK] });
  assert.equal(result.event, null);
});

test('a joint live matches only the event with both people', () => {
  const lunaIg = event({ id: 30, occurredOn: '2026-03-01', livePeopleIds: [LUNA], livePlatformCode: 'instagram' });
  const jointIg = event({ id: 31, occurredOn: '2026-03-01', livePeopleIds: [LUNA, SOL], livePlatformCode: 'instagram' });
  assert.equal(match('#solsunny #lunamoon IG live [260301]', { events: [lunaIg, jointIg] }).event?.id, 31);
  assert.equal(match('#lunamoon IG live [260301]', { events: [jointIg] }).event, null);
  const proposal = match('#solsunny #lunamoon IG live [260301]', { events: [lunaIg] }).proposal;
  assert.equal(proposal?.name, 'sol & luna ig live');
  assert.match(proposal?.slug ?? '', /^[a-z0-9-]+$/);
});

test('an unknown handle tag gives a shared story', () => {
  const result = match('#SolLuna #starguest');
  assert.equal(result.placement, 'shared_story');
  assert.equal(result.event, null);
  assert.equal(result.proposal, null);
});

test('post: known people’s own tags only; tagged people are the authors', () => {
  const result = match('#solsunny #lunamoon');
  assert.equal(result.placement, 'post');
  assert.deepEqual(result.authorIds, [SOL, LUNA]);
});

test('post: postAuthorIds from the caller', () => {
  const result = match('', { postAuthorIds: [SOL] });
  assert.equal(result.placement, 'post');
  assert.deepEqual(result.authorIds, [SOL]);
});

test('post rule does not apply when a keyword is present', () => {
  const result = match('SOL SAYS HELLO', { postAuthorIds: [SOL] });
  assert.equal(result.placement, 'event');
  assert.deepEqual(result.authorIds, []);
});

test('midnight: a no-date live posted 17:30Z proposes the Bangkok date, or the UTC date', () => {
  const postedAt = '2026-02-12T17:30:00Z';
  assert.equal(match('#lunamoon TikTok live', { postedAt }).proposal?.occurredOn, '2026-02-13');
  assert.equal(match('#lunamoon TikTok live', { postedAt, timezone: 'UTC' }).proposal?.occurredOn, '2026-02-12');
});

test('suggestions: events within ±1 day, excluding the match, at most 5', () => {
  const near = [0, 1, 2, 3, 4, 5].map((i) => event({ id: 100 + i, occurredOn: i % 2 ? '2026-10-18' : '2026-10-20' }));
  const far = event({ id: 200, occurredOn: '2026-10-25' });
  const result = match('#SLHappyDay2026', { events: [HAPPY_DAY, ...near, far], postedAt: '2026-10-19T08:00:00Z' });
  assert.equal(result.event?.id, 10);
  assert.equal(result.suggestions.length, 5);
  assert.ok(result.suggestions.every((s) => s.id !== 10 && s.id !== 200));
});

test('proposeEvent: keyword name, a slug from it, tags carried', () => {
  const proposal = proposeEvent({ header: header('SOLLUNA AT STARFEST\n#SolLunaStarfest'), date: '2026-10-18', people: PEOPLE, formatName: lower });
  assert.equal(proposal.name, 'SOLLUNA AT STARFEST');
  assert.equal(proposal.slug, 'solluna-at-starfest-2026-10-18');
  assert.deepEqual(proposal.keywords, ['SOLLUNA AT STARFEST']);
  assert.deepEqual(proposal.hashtags, ['sollunastarfest']);
  assert.equal(proposal.livePlatformCode, null);
});

test('proposeEvent: a name with no Latin letters still gives a valid slug', () => {
  const thai = { keyword: 'งานแฟนมีต', hashtags: [], personTags: [], unknownHandleTags: [], live: null, context: null };
  const proposal = proposeEvent({ header: thai, date: '2026-10-18', people: PEOPLE, formatName: lower });
  assert.match(proposal.slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
});
