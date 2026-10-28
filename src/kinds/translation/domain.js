// @ts-check
import { splitLines, findMarkers } from '../../domain/lines.js';
import { parseHeader, postTags } from '../../domain/header.js';
import { norm } from '../../domain/text.js';
import { resolveSpeakers, missingMarkers, personIdsFrom } from '../../domain/speakers.js';
import { matchEvent, proposeEvent, peopleForTags } from '../../domain/events.js';
import { validateFixes, partLines, unmappedMarkers } from '../../domain/lineFixes.js';

/**
 * @typedef {import('../../sources/normalize.js').Tweet} Tweet
 * @typedef {import('../defineKind.js').DraftContext} DraftContext
 * @typedef {import('../defineKind.js').DraftCommon} DraftCommon
 * @typedef {import('../defineKind.js').ItemPerson} ItemPerson
 * @typedef {import('../defineKind.js').MissingMarker} MissingMarker
 * @typedef {import('../../domain/header.js').Header} Header
 * @typedef {import('../../domain/events.js').Event} Event
 * @typedef {import('../../domain/events.js').EventMatch} EventMatch
 * @typedef {import('../../domain/events.js').EventProposal} EventProposal
 * @typedef {import('../../domain/speakers.js').SpeakerMap} SpeakerMap
 * @typedef {{sharingPersonId: number|null, sharingHandleSuggestion: string|null, aboutPersonIds: number[]}} SharedStory
 * @typedef {{
 *   common: DraftCommon,
 *   missing: MissingMarker[],
 *   suggestions: Event[],
 *   tweet: Tweet,
 *   text: string,
 *   header: Header,
 *   speakers: SpeakerMap,
 *   markers: import('../../domain/lines.js').Marker[],
 *   memory: SpeakerMap,
 *   sharedStory: SharedStory|null,
 *   newTags: string[],
 *   subbed: boolean,
 *   lineFixes: import('../../domain/lineFixes.js').LineFix[],
 *   parts: string[],
 *   lines: import('../../domain/lineFixes.js').FixedLine[],
 *   unmapped: MissingMarker[],
 * }} TranslationDraft
 *   `tweet` is the fetched source (sources, media, follow-ups and quote
 *   are persisted from it); `text` is the main text actually used.
 *   `markers` are the markers used across the text and its follow-ups;
 *   `memory` is what to remember for the credited account (what was
 *   remembered, overlaid with what the submitter chose -- never the
 *   site's defaults, so a changed default isn't shadowed later).
 *   `subbed`/`lineFixes` are the submitter's "already subbed" tick and
 *   line-level fixes; `parts` is the text split per part (main, then each
 *   follow-up), and `lines` is those parts through the fixes.
 * @typedef {{placement: import('../../domain/constants.js').Placement, eventId: number|null,
 *   proposal: EventProposal|null, authorIds: number[]}} Placing
 */

/** @param {string} handle */
function handleKey(handle) {
  return norm(handle.replace(/^@/, ''));
}

/**
 * The people whose own account posted the translated content: the quoted
 * tweet's author, else the clip/picture source's account.
 * @param {Tweet} tweet
 * @param {DraftContext['personAccounts']} accounts
 */
function postAuthorIdsOf(tweet, accounts) {
  for (const handle of [tweet.quoted?.authorHandle, tweet.clipSource?.handle]) {
    if (!handle) continue;
    const ids = accounts.filter((a) => a.platform === 'x' && handleKey(a.handle) === handleKey(handle)).map((a) => a.personId);
    if (ids.length > 0) return [...new Set(ids)];
  }
  return [];
}

/**
 * A copy of `proposal` whose slug no existing event has, numbered
 * `-2`, `-3`… with the name suffixed `(2)`, `(3)`…
 * @param {EventProposal} proposal
 * @param {Event[]} events
 */
function distinctProposal(proposal, events) {
  const taken = new Set(events.map((e) => e.slug));
  if (!taken.has(proposal.slug)) return proposal;
  let n = 2;
  while (taken.has(`${proposal.slug}-${n}`)) n += 1;
  return { ...proposal, slug: `${proposal.slug}-${n}`, name: `${proposal.name} (${n})` };
}

/** @param {number[][]} lists */
function firstNonEmpty(...lists) {
  return lists.find((list) => list.length > 0) ?? [];
}

/**
 * A new event takes the adder's typed title when given (owner, 2026-10-23);
 * its slug stays derived from the keyword, so links don't depend on the
 * title. An existing event is never renamed here.
 * @param {Placing} placing @param {string|undefined} eventName
 * @returns {Placing}
 */
function titled(placing, eventName) {
  const name = eventName?.trim();
  return name && placing.proposal ? { ...placing, proposal: { ...placing.proposal, name } } : placing;
}

/**
 * Where the item goes once the submitter's overrides are applied. A
 * proposal made only because of an override is kept distinct from
 * existing slugs (a signal-less one is just `event-<date>`). A forced
 * post prefers the linked-account authors, then the tagged people.
 * @param {EventMatch} match
 * @param {{ctx: DraftContext, header: Header, tagIds: number[], postAuthorIds: number[]}} input
 * @returns {Placing}
 */
function placingOf(match, { ctx, header, tagIds, postAuthorIds }) {
  const { overrides, events, people, formatName } = ctx;
  const propose = () => distinctProposal(proposeEvent({ header, date: match.date, people, formatName }), events);
  const none = { eventId: null, proposal: null, authorIds: [] };
  if (overrides.eventId !== undefined) return { ...none, placement: 'event', eventId: overrides.eventId };
  if (overrides.newEvent) return { ...none, placement: 'event', proposal: propose() };
  const placement = overrides.placement ?? match.placement;
  if (placement === 'event') {
    if (match.placement !== 'event') return { ...none, placement, proposal: propose() };
    return { ...none, placement, eventId: match.event?.id ?? null, proposal: match.proposal };
  }
  if (placement === 'post') return { ...none, placement, authorIds: firstNonEmpty(match.authorIds, postAuthorIds, tagIds) };
  return { ...none, placement };
}

/**
 * The sharer is a known person tag when there is one; otherwise a new
 * tag is suggested as their handle (never guessed as a person on its
 * own -- this only runs once `overrides.placement` already says
 * `shared_story`).
 * @param {number[]} tagIds
 * @param {number[]} speakerIds
 * @param {string[]} newTags
 * @returns {SharedStory}
 */
function sharedStoryOf(tagIds, speakerIds, newTags) {
  const sharingPersonId = tagIds[0] ?? null;
  const about = [...new Set([...tagIds, ...speakerIds])].filter((id) => id !== sharingPersonId);
  const sharingHandleSuggestion = sharingPersonId === null ? (newTags[0] ?? null) : null;
  return { sharingPersonId, sharingHandleSuggestion, aboutPersonIds: about };
}

/**
 * @param {Placing} placing
 * @param {SharedStory|null} story
 * @param {number[]} presentIds
 * @returns {ItemPerson[]}
 */
function itemPeopleOf(placing, story, presentIds) {
  if (placing.placement === 'post') return placing.authorIds.map((personId) => ({ personId, role: 'author' }));
  if (story) {
    const sharing = story.sharingPersonId === null ? [] : [{ personId: story.sharingPersonId, role: /** @type {const} */ ('sharing') }];
    return [...sharing, ...story.aboutPersonIds.map((personId) => ({ personId, role: /** @type {const} */ ('about') }))];
  }
  return presentIds.map((personId) => ({ personId, role: 'present' }));
}

/**
 * @param {Tweet} tweet
 * @param {DraftContext['overrides']} overrides
 */
function sourceFieldsOf(tweet, overrides) {
  const selfQuote = tweet.quoted !== null && tweet.quoted.authorId !== null && tweet.quoted.authorId === tweet.authorId;
  return {
    postedAt: tweet.createdAt,
    credited: { platform: 'x', externalId: tweet.authorId, handle: tweet.authorHandle, displayName: tweet.authorName },
    primary: { platform: 'x', externalId: tweet.id, url: `https://x.com/${tweet.authorHandle ?? 'i'}/status/${tweet.id}` },
    categoryName: overrides.categoryName ?? null,
    clientName: overrides.clientName ?? null,
    textEnteredManually: overrides.text !== undefined,
    followsOn: selfQuote && tweet.quoted ? { platform: 'x', externalId: tweet.quoted.id } : null,
  };
}

/**
 * @param {Tweet} tweet
 * @param {DraftContext} ctx
 */
function readText(tweet, ctx) {
  const text = ctx.overrides.text ?? tweet.text;
  const personHandles = ctx.people.flatMap((p) => [p.igHandle, ...(p.extraHashtags ?? [])]);
  const header = parseHeader(text, {
    ignoredHashtags: ctx.ignoredHashtags,
    personHandles,
    livePatterns: ctx.livePatterns,
    postedAt: tweet.createdAt,
    timezone: ctx.timezone,
  });
  const allText = [text, ...tweet.followUps.map((f) => f.text)].join('\n');
  // Every part of the post, follow-ups included: an event hashtag may close the thread.
  const post = { tags: postTags(allText, { ignoredHashtags: ctx.ignoredHashtags, personHandles }) };
  return { text, header, post, markers: findMarkers(splitLines(allText)) };
}

/**
 * Decides everything about what a translation item is: its speakers,
 * event (matched or proposed), placement, people, and links. Pure.
 * @param {Tweet} tweet
 * @param {DraftContext} ctx
 * @returns {TranslationDraft}
 */
export function draftTranslation(tweet, ctx) {
  const { text, header, post, markers } = readText(tweet, ctx);
  const speakers = resolveSpeakers({ defaults: ctx.defaultMarkers, people: ctx.people, remembered: ctx.remembered, chosen: ctx.chosen });
  const postAuthorIds = postAuthorIdsOf(tweet, ctx.personAccounts);
  const { events, people, formatName, timezone } = ctx;
  const match = matchEvent({ header, postedAt: tweet.createdAt, events, people, formatName, timezone, postAuthorIds, post });
  const tagIds = peopleForTags(header.personTags, ctx.people).map((p) => p.id);
  const speakerIds = personIdsFrom(speakers, markers);
  const placing = titled(placingOf(match, { ctx, header, tagIds, postAuthorIds }), ctx.overrides.eventName);
  const sharedStory = placing.placement === 'shared_story' ? sharedStoryOf(tagIds, speakerIds, match.newTags) : null;
  const presentIds = [...new Set([...speakerIds, ...tagIds])];
  const common = {
    placement: placing.placement,
    eventId: placing.eventId,
    proposal: placing.proposal,
    occurredOn: match.date,
    people: itemPeopleOf(placing, sharedStory, presentIds),
    ...sourceFieldsOf(tweet, ctx.overrides),
  };
  const memory = { ...ctx.remembered, ...ctx.chosen };
  const subbed = ctx.overrides.subbed === true;
  const lineFixes = ctx.overrides.lineFixes ?? [];
  // Every part of the post (main + follow-ups), in order: what line fixes
  // are validated against and what `lines` renders.
  const parts = [text, ...tweet.followUps.map((f) => f.text)];
  validateFixes(parts, lineFixes);
  const missing = subbed ? [] : missingMarkers(markers, speakers);
  const unmapped = subbed ? [] : unmappedMarkers(parts, lineFixes, speakers);
  return {
    common, missing, suggestions: match.suggestions, tweet, text, header, speakers, markers, memory, sharedStory, newTags: match.newTags,
    subbed, lineFixes, parts, lines: partLines(parts, lineFixes), unmapped,
  };
}

/**
 * The item people that `speakers` alone contributes for an archived item,
 * derived exactly as `draftTranslation` derives them (`itemPeopleOf`,
 * with the person tags of the first part's header): `present` for an
 * event or unsorted item, `about` (and the tagged sharer) for a shared
 * story, and nothing for a post (its people are its authors). The remap
 * command (src/kinds/translation/remap.js) diffs this for the old and new
 * map, so people that came from anywhere else stay. Line fixes contribute
 * their fixed speakers. Pure.
 * @param {{ parts: string[], placement: import('../../domain/constants.js').Placement }} item
 * @param {SpeakerMap} speakers
 * @param {DraftContext} ctx
 * @param {import('../../domain/lineFixes.js').LineFix[]} [fixes]
 * @returns {ItemPerson[]}
 */
export function speakerPeopleOf({ parts, placement }, speakers, ctx, fixes = []) {
  if (placement === 'post') return [];
  const [first = '', ...rest] = parts;
  const tweet = /** @type {Tweet} */ (/** @type {unknown} */ ({ text: first, createdAt: null, followUps: rest.map((text) => ({ text })) }));
  const { header, markers } = readText(tweet, { ...ctx, overrides: {} });
  const tagIds = peopleForTags(header.personTags, ctx.people).map((p) => p.id);
  const speakerIds = personIdsFrom(speakers, markers);
  for (const fix of fixes) {
    if (fix.as === 'speech' && 'person' in fix.speaker && !speakerIds.includes(fix.speaker.person)) speakerIds.push(fix.speaker.person);
  }
  const story = placement === 'shared_story' ? sharedStoryOf(tagIds, speakerIds, []) : null;
  const placing = { placement, eventId: null, proposal: null, authorIds: [] };
  return itemPeopleOf(placing, story, [...new Set([...speakerIds, ...tagIds])]);
}

