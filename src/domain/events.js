// @ts-check
import { norm } from './text.js';
import { daysBetween, localDate } from './dates.js';
import { LIVE_WINDOW_DAYS } from './constants.js';

/**
 * @typedef {import('./header.js').Header} Header
 * @typedef {import('./constants.js').Placement} Placement
 * @typedef {{
 *   id: number, slug: string, name: string, occurredOn: string,
 *   categoryId: number|null, clientId: number|null,
 *   keywords: string[], hashtags: string[],
 *   livePeopleIds: number[], livePlatformCode: string|null,
 * }} Event
 * @typedef {{
 *   name: string, slug: string, occurredOn: string|null,
 *   keywords: string[], hashtags: string[],
 *   livePeopleIds: number[], livePlatformCode: string|null,
 * }} EventProposal
 * @typedef {{id: number, displayName: string, igHandle: string, extraHashtags?: string[]}} EventPerson
 * @typedef {(name: string) => string} FormatName
 * @typedef {{
 *   placement: Placement,
 *   event: Event|null,
 *   proposal: EventProposal|null,
 *   suggestions: Event[],
 *   authorIds: number[],
 *   date: string|null,
 *   newTags: string[],
 * }} EventMatch
 */

const MAX_SUGGESTIONS = 5;
const SUGGESTION_WINDOW_DAYS = 1;

/** @param {string} handle */
function handleKey(handle) {
  return norm(handle.replace(/^@/, ''));
}

/**
 * The known people named by a header's person tags, in tag order. A tag
 * matches a person's IG handle or one of their extra hashtags.
 * @param {string[]} tags
 * @param {EventPerson[]} people
 * @returns {EventPerson[]}
 */
export function peopleForTags(tags, people) {
  /** @type {EventPerson[]} */
  const found = [];
  for (const tag of tags) {
    const person = people.find((p) => [p.igHandle, ...(p.extraHashtags ?? [])].some((h) => handleKey(h) === tag));
    if (person && !found.includes(person)) found.push(person);
  }
  return found;
}

/**
 * Lower-case ASCII words joined by `-`; diacritics are dropped. A name
 * with nothing left (e.g. all Thai) falls back to `event`.
 * @param {string} name
 */
function slugify(name) {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'event';
}

/**
 * @param {Event[]} events
 * @param {string|null} date
 */
function byCloseness(events, date) {
  if (!date) return events;
  const distance = (/** @type {Event} */ e) => Math.abs(daysBetween(date, e.occurredOn));
  return [...events].sort((a, b) => distance(a) - distance(b));
}

/** @param {number[]} a @param {number[]} b */
function sameSet(a, b) {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/**
 * Rule 1: a keyword or any header tag (by `norm`) that an event already
 * has. A tag is never classified by shape, so a lower-case tag is tried
 * exactly like any other.
 * @param {Header} header
 * @param {Event[]} events
 * @param {string|null} date
 */
function matchByTag(header, events, date) {
  const keyword = header.keyword ? norm(header.keyword) : null;
  const tags = new Set(header.tags.map(norm));
  const hits = events.filter(
    (e) => (keyword !== null && e.keywords.some((k) => norm(k) === keyword)) || e.hashtags.some((h) => tags.has(norm(h))),
  );
  return byCloseness(hits, date)[0] ?? null;
}

/**
 * Every hashtag/keyword any given event already has, normed -- the
 * vocabulary a header tag must be outside of to count as new.
 * @param {Event[]} events
 */
function knownEventTags(events) {
  return new Set(events.flatMap((e) => [...e.hashtags, ...e.keywords]).map(norm));
}

/**
 * Header tags that match no existing event's hashtags or keywords (by
 * `norm`). `header.tags` already excludes person and ignored tags.
 * @param {Header} header
 * @param {Event[]} events
 * @returns {string[]}
 */
function newTagsOf(header, events) {
  const known = knownEventTags(events);
  return header.tags.filter((tag) => !known.has(norm(tag)));
}

/**
 * Rule 2: a live by exactly the same set of people, on the same platform,
 * within `LIVE_WINDOW_DAYS` of the entry date.
 * @param {Header} header
 * @param {number[]} liveIds
 * @param {Event[]} events
 * @param {string|null} date
 */
function matchByLive(header, liveIds, events, date) {
  const live = header.live;
  if (!live || liveIds.length === 0 || !date) return null;
  const hits = events.filter(
    (e) =>
      e.livePlatformCode === live.platformCode &&
      sameSet(e.livePeopleIds, liveIds) &&
      Math.abs(daysBetween(date, e.occurredOn)) <= LIVE_WINDOW_DAYS,
  );
  return byCloseness(hits, date)[0] ?? null;
}

/**
 * @param {Event[]} events
 * @param {string|null} date
 * @param {Event|null} matched
 */
function suggestionsNear(events, date, matched) {
  if (!date) return [];
  const near = events.filter((e) => e.id !== matched?.id && Math.abs(daysBetween(date, e.occurredOn)) <= SUGGESTION_WINDOW_DAYS);
  return byCloseness(near, date).slice(0, MAX_SUGGESTIONS);
}

/**
 * @param {Header} header
 * @param {EventPerson[]} livePeople
 * @param {FormatName} formatName
 */
function proposalName(header, livePeople, formatName) {
  if (header.keyword) return header.keyword;
  if (header.live) return [livePeople.map((p) => formatName(p.displayName)).join(' & '), header.live.code].filter(Boolean).join(' ');
  return header.tags[0] ?? 'event';
}

/**
 * A new event built from a header: named after the keyword, else the
 * live's people and platform (`"a & b ig live"`), else the first
 * hashtag. The slug is the name's slug plus the date.
 * @param {{header: Header, date: string|null, people: EventPerson[], formatName: FormatName}} input
 * @returns {EventProposal}
 */
export function proposeEvent({ header, date, people, formatName }) {
  const livePeople = header.live ? peopleForTags(header.personTags, people) : [];
  const name = proposalName(header, livePeople, formatName);
  return {
    name,
    slug: date ? `${slugify(name)}-${date}` : slugify(name),
    occurredOn: date,
    keywords: header.keyword ? [header.keyword] : [],
    hashtags: [...header.tags],
    livePeopleIds: livePeople.map((p) => p.id),
    livePlatformCode: header.live?.platformCode ?? null,
  };
}

/**
 * Placement when no event matched or was proposed. `shared_story` is
 * never inferred here -- it only ever comes from `overrides.placement`.
 * A post needs either a linked post author or known tagged people with
 * no new tags still unaccounted for; otherwise the entry is unsorted,
 * surfacing its new tags to be asked about.
 * @param {number[]} tagIds
 * @param {number[]} postAuthorIds
 * @param {string[]} newTags
 * @returns {{placement: Placement, authorIds: number[]}}
 */
function placementWithoutEvent(tagIds, postAuthorIds, newTags) {
  if (postAuthorIds.length > 0) return { placement: 'post', authorIds: [...postAuthorIds] };
  if (tagIds.length > 0 && newTags.length === 0) return { placement: 'post', authorIds: tagIds };
  return { placement: 'unsorted', authorIds: [] };
}

/**
 * Decides where an entry goes, from its header. In order: an existing
 * event by keyword/tag; an existing live by who/where/when; a new event
 * when there's a keyword or a live (never from a tag alone); else a
 * post, or unsorted. The entry date is the live's date, else the posting
 * date in the site's time zone. `newTags`: header tags that matched no
 * existing event and aren't known (person/ignored tags never reach here).
 * @param {{header: Header, postedAt: string|null, events: Event[], people: EventPerson[],
 *   formatName: FormatName, timezone: string, postAuthorIds?: number[]}} input
 * @returns {EventMatch}
 */
export function matchEvent({ header, postedAt, events, people, formatName, timezone, postAuthorIds = [] }) {
  const date = header.live?.date ?? (postedAt ? localDate(postedAt, timezone) : null);
  const tagIds = peopleForTags(header.personTags, people).map((p) => p.id);
  const matched = matchByTag(header, events, date) ?? matchByLive(header, tagIds, events, date);
  const newTags = newTagsOf(header, events);
  const base = { date, suggestions: suggestionsNear(events, date, matched), authorIds: [], newTags };
  if (matched) return { ...base, placement: 'event', event: matched, proposal: null };
  if (header.keyword || header.live) {
    return { ...base, placement: 'event', event: null, proposal: proposeEvent({ header, date, people, formatName }) };
  }
  return { ...base, ...placementWithoutEvent(tagIds, postAuthorIds, newTags), event: null, proposal: null };
}
