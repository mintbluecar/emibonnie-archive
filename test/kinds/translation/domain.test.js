// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { draftTranslation } from '../../../src/kinds/translation/domain.js';
import { LIVE_PATTERNS } from '../../../src/domain/constants.js';
import { fetchTweet } from '../../../src/sources/fetchTweet.js';
import { IDS, fixtureDeps } from '../../helpers/fixtures.js';

const SITE = JSON.parse(readFileSync('examples/solluna/site.json', 'utf8'));
const SOL = 1;
const LUNA = 2;
const HOST = 3;
const PEOPLE = [
  { id: SOL, displayName: 'sol', igHandle: 'solsunny' },
  { id: LUNA, displayName: 'luna', igHandle: 'lunamoon' },
  { id: HOST, displayName: 'host', igHandle: 'host_ig' },
];
const SOL_X = [{ platform: 'x', handle: 'solsunny_x', personId: SOL }];

/** @type {import('../../../src/domain/events.js').Event} */
const HAPPY_DAY = {
  id: 10,
  slug: 'solluna-happy-day-2026-10-19',
  name: 'SOLLUNA HAPPY DAY',
  occurredOn: '2026-10-19',
  categoryId: null,
  clientId: null,
  keywords: ['SOLLUNA HAPPY DAY'],
  hashtags: ['slhappyday2026'],
  livePeopleIds: [],
  livePlatformCode: null,
};

/**
 * @param {Partial<import('../../../src/kinds/defineKind.js').DraftContext>} [extra]
 * @returns {import('../../../src/kinds/defineKind.js').DraftContext}
 */
function ctx(extra = {}) {
  return {
    people: PEOPLE,
    personAccounts: [],
    events: [],
    ignoredHashtags: SITE.ignoredHashtags,
    livePatterns: LIVE_PATTERNS,
    defaultMarkers: SITE.defaultMarkers,
    timezone: SITE.timezone,
    formatName: (name) => name.toLowerCase(),
    remembered: {},
    chosen: {},
    overrides: {},
    ...extra,
  };
}

/** @param {string} id */
async function tweet(id) {
  return fetchTweet(fixtureDeps(), id);
}

/**
 * A synthetic tweet with the given text and nothing else.
 * @param {string} text
 * @returns {import('../../../src/sources/normalize.js').Tweet}
 */
function tweetWith(text) {
  return {
    id: '1990000000000000001', status: 'live', authorId: '9009', authorHandle: 'tl_test', authorName: 'test',
    createdAt: '2026-02-12T13:00:00.000Z', text, textSource: 'fx', video: null, images: [], quoted: null,
    clipSource: null, quotedId: null, replyToId: null, followUps: [],
    edit: { versionIds: ['1990000000000000001'], latestId: '1990000000000000001', editableUntil: null, isStale: false },
  };
}

/** @param {{personId: number, role: string}[]} people */
function byRole(people) {
  return people.map((p) => `${p.personId}:${p.role}`).sort();
}

test('LONG with no memory: missing 🦁 🌧️ 🐶 🐱, and a proposal', async () => {
  const draft = draftTranslation(await tweet(IDS.LONG), ctx());
  assert.deepEqual(draft.missing.map((m) => m.marker), ['🦁', '🌧️', '🐶', '🐱']);
  assert.equal(draft.common.placement, 'event');
  assert.equal(draft.common.eventId, null);
  assert.equal(draft.common.proposal?.name, 'SOLLUNA AT STARFEST');
  assert.equal(draft.common.occurredOn, '2026-10-18');
});

test('LONG: common carries the credited account and the primary source', async () => {
  const { common } = draftTranslation(await tweet(IDS.LONG), ctx());
  assert.deepEqual(common.credited, { platform: 'x', externalId: '9001', handle: 'tl_alpha', displayName: 'alpha clips' });
  assert.deepEqual(common.primary, { platform: 'x', externalId: IDS.LONG, url: `https://x.com/tl_alpha/status/${IDS.LONG}` });
  assert.equal(common.postedAt, '2026-10-18T10:15:00.000Z');
  assert.equal(common.textEnteredManually, false);
});

test('LONG with everything chosen: nothing missing, chosen people are present', async () => {
  const chosen = { '🦁': { person: HOST }, '🌧️': { role: 'fan' }, '🐶': { person: SOL }, '🐱': { person: LUNA } };
  const draft = draftTranslation(await tweet(IDS.LONG), ctx({ chosen: /** @type {any} */ (chosen) }));
  assert.deepEqual(draft.missing, []);
  assert.deepEqual(byRole(draft.common.people), [`${SOL}:present`, `${LUNA}:present`, `${HOST}:present`]);
});

test('EVENT_B matches an existing event', async () => {
  const draft = draftTranslation(await tweet(IDS.EVENT_B), ctx({ events: [HAPPY_DAY] }));
  assert.equal(draft.common.placement, 'event');
  assert.equal(draft.common.eventId, 10);
  assert.equal(draft.common.proposal, null);
  assert.deepEqual(draft.missing, []);
});

test('SHARED without the override: unsorted, not shared_story, with starguest as a new tag', async () => {
  const draft = draftTranslation(await tweet(IDS.SHARED), ctx());
  assert.equal(draft.common.placement, 'unsorted');
  assert.equal(draft.common.eventId, null);
  assert.equal(draft.common.proposal, null);
  assert.equal(draft.sharedStory, null);
  assert.deepEqual(draft.newTags, ['starguest']);
});

test('SHARED with the shared_story override: suggests the new tag as the sharer', async () => {
  const draft = draftTranslation(await tweet(IDS.SHARED), ctx({ overrides: { placement: 'shared_story' } }));
  assert.equal(draft.common.placement, 'shared_story');
  assert.equal(draft.common.eventId, null);
  assert.equal(draft.common.proposal, null);
  assert.equal(draft.sharedStory?.sharingHandleSuggestion, 'starguest');
  assert.deepEqual(draft.missing.map((m) => m.marker), ['🪇']);
});

test('a shared story with a known sharer records sharing and about people', () => {
  const draft = draftTranslation(tweetWith('#host_ig #lunamoon\n\n🦁: she was so kind'), ctx({ overrides: { placement: 'shared_story' }, chosen: { '🦁': { person: HOST } } }));
  assert.equal(draft.common.placement, 'shared_story');
  assert.deepEqual(byRole(draft.common.people), [`${LUNA}:about`, `${HOST}:sharing`]);
});

test('POST with a linked X account: placement post, sol as author, nothing missing', async () => {
  const draft = draftTranslation(await tweet(IDS.POST), ctx({ personAccounts: SOL_X }));
  assert.equal(draft.common.placement, 'post');
  assert.equal(draft.common.eventId, null);
  assert.deepEqual(draft.common.people, [{ personId: SOL, role: 'author' }]);
  assert.deepEqual(draft.missing, []);
  assert.equal(draft.common.followsOn, null);
});

test('PHOTO (#solsunny only): placement post with sol as author', async () => {
  const draft = draftTranslation(await tweet(IDS.PHOTO), ctx());
  assert.equal(draft.common.placement, 'post');
  assert.deepEqual(draft.common.people, [{ personId: SOL, role: 'author' }]);
});

test('#solsunny #lunamoon with no keyword: a post with both as authors', () => {
  const draft = draftTranslation(tweetWith('#solsunny #lunamoon\n\n☀️: hi\n🌙: hi'), ctx());
  assert.equal(draft.common.placement, 'post');
  assert.deepEqual(byRole(draft.common.people), [`${SOL}:author`, `${LUNA}:author`]);
});

test('#lunamoon TikTok live [260212]: the live wins over the post rule', () => {
  const draft = draftTranslation(tweetWith('#lunamoon TikTok live [260212]\n\n🌙: hi'), ctx());
  assert.equal(draft.common.placement, 'event');
  assert.equal(draft.common.proposal?.name, 'luna tiktok live');
  assert.equal(draft.common.occurredOn, '2026-02-12');
});

test('#solsunny #starguest: a new tag keeps it from being a post, unsorted with the new tag surfaced', () => {
  const draft = draftTranslation(tweetWith('#solsunny #starguest\n\n☀️: hi'), ctx());
  assert.equal(draft.common.placement, 'unsorted');
  assert.deepEqual(draft.newTags, ['starguest']);
});

test('a tweet quoting its own author sets followsOn', async () => {
  const draft = draftTranslation(await tweet(IDS.LONG), ctx());
  assert.deepEqual(draft.common.followsOn, { platform: 'x', externalId: IDS.LONG_QUOTED });
});

test('newEvent forces a proposal, with a slug that does not collide', async () => {
  const draft = draftTranslation(await tweet(IDS.EVENT_B), ctx({ events: [HAPPY_DAY], overrides: { newEvent: true } }));
  assert.equal(draft.common.eventId, null);
  assert.equal(draft.common.placement, 'event');
  assert.equal(draft.common.proposal?.slug, 'solluna-happy-day-2026-10-19-2');
  assert.equal(draft.common.proposal?.name, 'SOLLUNA HAPPY DAY (2)');
});

test('an eventId override files the item under that event', async () => {
  const draft = draftTranslation(await tweet(IDS.SHARED), ctx({ events: [HAPPY_DAY], overrides: { eventId: 10 } }));
  assert.equal(draft.common.placement, 'event');
  assert.equal(draft.common.eventId, 10);
  assert.equal(draft.common.proposal, null);
});

test('a placement override to unsorted drops the event', async () => {
  const draft = draftTranslation(await tweet(IDS.EVENT_B), ctx({ events: [HAPPY_DAY], overrides: { placement: 'unsorted' } }));
  assert.equal(draft.common.placement, 'unsorted');
  assert.equal(draft.common.eventId, null);
  assert.equal(draft.common.proposal, null);
});

test('overrides.text replaces the tweet text and marks it entered manually', () => {
  const draft = draftTranslation(tweetWith(''), ctx({ overrides: { text: '🦁: typed in by hand' } }));
  assert.equal(draft.common.textEnteredManually, true);
  assert.equal(draft.text, '🦁: typed in by hand');
  assert.deepEqual(draft.missing.map((m) => m.marker), ['🦁']);
});

test("a 'post' override keeps the linked-account authors even when the header matched an event", async () => {
  const post = await tweet(IDS.POST);
  const withHeader = { ...post, text: `SOLLUNA HAPPY DAY\n#SLHappyDay2026\n\n${post.text}` };
  const matched = draftTranslation(withHeader, ctx({ personAccounts: SOL_X, events: [HAPPY_DAY] }));
  assert.equal(matched.common.eventId, 10);
  const draft = draftTranslation(withHeader, ctx({ personAccounts: SOL_X, events: [HAPPY_DAY], overrides: { placement: 'post' } }));
  assert.equal(draft.common.placement, 'post');
  assert.deepEqual(draft.common.people, [{ personId: SOL, role: 'author' }]);
});

test("an 'event' override with no signals proposes a slug that does not collide", () => {
  const taken = { ...HAPPY_DAY, id: 11, slug: 'event-2026-02-12', name: 'event', occurredOn: '2026-02-12' };
  const draft = draftTranslation(tweetWith('🦁: hi'), ctx({ events: [taken], overrides: { placement: 'event' } }));
  assert.equal(draft.common.placement, 'event');
  assert.equal(draft.common.proposal?.slug, 'event-2026-02-12-2');
});
