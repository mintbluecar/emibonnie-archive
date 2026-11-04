// @ts-check
/**
 * The edit event page's pure state (event editing, spec screen ②): which
 * of its three modes the query asks for, the fields each mode starts
 * from, and the edits the form makes to them. No DOM, no network.
 *
 * - edit (`?id=3`): the event's own fields.
 * - merge (`?merge=3,7`): the kept event's (default: the visible one with
 *   the most entries)
 *   title, date, live and address, with the keywords and hashtags of
 *   every merged event combined, kept event first.
 * - create (`?from=5&items=11,12`): a blank event dated by the earliest
 *   ticked entry.
 *
 * Hashtags are stored without their `#` (as the import reads them); the
 * form shows them with it, and an added tag starting with `#` is a
 * hashtag, anything else a keyword. `addressTag` is one of the hashtags,
 * or `''` for "from the title".
 */
import { eventHref, slugPart } from '../core/routes.js';

/**
 * @typedef {import('../../../src/services/eventFields.js').EventFields} EventFields
 * @typedef {import('../../../src/http/contracts.js').AdminEvent} AdminEvent
 * @typedef {import('../../../src/http/contracts.js').EventEntry} EventEntry
 * @typedef {{ mode: 'edit', id: number } | { mode: 'merge', ids: number[] }
 *   | { mode: 'create', fromId: number, itemIds: number[] }} Mode
 */

const ID = /^[1-9]\d*$/;

/** A positive integer id out of a query value, or null. The tweets in event page reads its `?id=` with this too. @param {string|null} text @returns {number|null} */
export function idOf(text) {
  if (text === null || !ID.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) ? id : null;
}

/** `'3,7'` -> `[3, 7]`; null for an empty list, a bad id or the same id twice. @param {string|null} text @returns {number[]|null} */
function idsOf(text) {
  if (!text) return null;
  const ids = text.split(',').map(idOf);
  if (ids.some((id) => id === null) || new Set(ids).size !== ids.length) return null;
  return /** @type {number[]} */ (ids);
}

/**
 * The mode a page query asks for, or `null` when it can't be read (no
 * mode, two modes, a bad id, a merge of fewer than two events).
 * @param {string} search `location.search` @returns {Mode|null}
 */
export function modeOf(search) {
  const query = new URLSearchParams(search);
  const asked = ['id', 'merge', 'from'].filter((key) => query.has(key));
  if (asked.length !== 1) return null;
  if (asked[0] === 'id') {
    const id = idOf(query.get('id'));
    return id === null ? null : { mode: 'edit', id };
  }
  if (asked[0] === 'merge') {
    const ids = idsOf(query.get('merge'));
    return ids && ids.length >= 2 ? { mode: 'merge', ids } : null;
  }
  const fromId = idOf(query.get('from'));
  const itemIds = idsOf(query.get('items'));
  return fromId !== null && itemIds ? { mode: 'create', fromId, itemIds } : null;
}

/** @param {string} tag */
const keyOf = (tag) => tag.trim().toLowerCase();

/** The lists joined, each tag once (case-insensitive), first spelling and order kept. @param {string[][]} lists @returns {string[]} */
export function unionTags(lists) {
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const tag of lists.flat()) if (!seen.has(keyOf(tag))) seen.set(keyOf(tag), tag.trim());
  return [...seen.values()];
}

/**
 * The hashtag an event's address came from (its slug's tag half, past a
 * `-2` clash suffix), else `''` (the title).
 * @param {AdminEvent} event @returns {string}
 */
export function addressChoiceOf(event) {
  const tag = event.slug.slice(event.slug.indexOf('/') + 1);
  const bare = tag.replace(/-\d+$/, '');
  return event.hashtags.find((h) => slugPart(h) === tag) ?? event.hashtags.find((h) => slugPart(h) === bare) ?? '';
}

/** @param {AdminEvent} event @returns {EventFields} */
function fieldsOf(event) {
  return {
    name: event.name, occurredOn: event.occurredOn, keywords: [...event.keywords], hashtags: [...event.hashtags],
    livePeopleIds: [...event.livePeopleIds], livePlatformCode: event.livePlatformCode, addressTag: addressChoiceOf(event),
  };
}

/**
 * The event a merge keeps unless the owner picks another: the visible
 * event with the most entries (keeping a hidden one would hide every
 * moved tweet), the most entries overall only when every one is hidden;
 * the first listed on a tie.
 * @param {AdminEvent[]} events @returns {number}
 */
export function defaultKeepId(events) {
  const visible = events.filter((e) => !e.hidden);
  const pool = visible.length > 0 ? visible : events;
  return pool.reduce((best, e) => (e.entryCount > best.entryCount ? e : best), pool[0]).id;
}

/** @param {AdminEvent[]} events @param {number} keepId @returns {AdminEvent[]} the kept event first */
const keptFirst = (events, keepId) => [...events].sort((a, b) => Number(b.id === keepId) - Number(a.id === keepId));

/**
 * The fields a mode starts from. `events` is the event (edit), every
 * merged event (merge) or the event the entries move out of (create);
 * `entries` is that event's entries (create only).
 * @param {Mode} mode @param {AdminEvent[]} events @param {EventEntry[]} [entries] @returns {EventFields}
 */
export function initialFields(mode, events, entries = []) {
  if (mode.mode === 'edit') return fieldsOf(events[0]);
  if (mode.mode === 'merge') {
    const ordered = keptFirst(events, defaultKeepId(events));
    return {
      ...fieldsOf(ordered[0]),
      keywords: unionTags(ordered.map((e) => e.keywords)),
      hashtags: unionTags(ordered.map((e) => e.hashtags)),
    };
  }
  const dates = entries.filter((e) => mode.itemIds.includes(e.itemId)).map((e) => e.occurredOn).sort();
  return {
    name: '', occurredOn: dates[0] ?? events[0].occurredOn, keywords: [], hashtags: [],
    livePeopleIds: [], livePlatformCode: null, addressTag: '',
  };
}

/**
 * A merge's kept event changed: its title, date, live and address come
 * in; the tags (already combined, perhaps edited) stay, and the address
 * choice is read against them.
 * @param {EventFields} fields @param {AdminEvent} kept @returns {EventFields}
 */
export function reseeded(fields, kept) {
  const { keywords, hashtags } = fields;
  return { ...fieldsOf({ ...kept, keywords, hashtags }), keywords, hashtags };
}

/** @param {EventFields} fields @param {string} text @returns {EventFields} the same object when nothing was added */
export function withTagAdded(fields, text) {
  const trimmed = text.trim();
  const isHashtag = trimmed.startsWith('#');
  const tag = isHashtag ? trimmed.replace(/^#+/, '').trim() : trimmed;
  const list = isHashtag ? fields.hashtags : fields.keywords;
  if (tag === '' || list.some((t) => keyOf(t) === keyOf(tag))) return fields;
  return isHashtag ? { ...fields, hashtags: [...list, tag] } : { ...fields, keywords: [...list, tag] };
}

/** @param {EventFields} fields @param {'keyword'|'hashtag'} kind @param {string} tag @returns {EventFields} */
export function withTagRemoved(fields, kind, tag) {
  if (kind === 'keyword') return { ...fields, keywords: fields.keywords.filter((t) => t !== tag) };
  const addressTag = fields.addressTag === tag ? '' : fields.addressTag;
  return { ...fields, hashtags: fields.hashtags.filter((t) => t !== tag), addressTag };
}

/** @param {EventFields} fields @param {number} id @returns {EventFields} */
export function withPersonAdded(fields, id) {
  return fields.livePeopleIds.includes(id) ? fields : { ...fields, livePeopleIds: [...fields.livePeopleIds, id] };
}

/** @param {EventFields} fields @param {number} id @returns {EventFields} */
export function withPersonRemoved(fields, id) {
  return { ...fields, livePeopleIds: fields.livePeopleIds.filter((p) => p !== id) };
}

/** What a save sends: the title stands in for an unchosen address hashtag. @param {EventFields} fields @returns {EventFields} */
export function bodyOf(fields) {
  return { ...fields, addressTag: fields.addressTag || fields.name };
}

/**
 * The address these fields save to, `/e/<date>/<tag>` (the server adds a
 * `-2` if another event already has it; a locked event keeps its own).
 * @param {EventFields} fields @returns {string}
 */
export function addressPreview(fields) {
  return eventHref(`${fields.occurredOn}/${slugPart(bodyOf(fields).addressTag)}`);
}

/** What a merge moves into the kept event: the other events' entries. @param {AdminEvent[]} events @param {number} keepId */
export function moveSummary(events, keepId) {
  const others = events.filter((e) => e.id !== keepId);
  return { tweets: others.reduce((sum, e) => sum + e.entryCount, 0), events: others.length };
}
