// @ts-check
/**
 * Read views for the owner's event admin pages (Task 7): the event list,
 * one event with its edit form's options, and one event's entries with a
 * snippet (Ruling R6/R6a). Routes may not import `src/repo/` or `src/db/`
 * directly (layer rule), so every GET the admin pages make goes through
 * one of these.
 */
import { getAdminEvent, listAdminEvents, listEventEntries, listPlatforms } from '../repo/eventAdmin.js';
import { listPeople } from '../repo/people.js';
import { presenterContext, previewsForAny } from './cards.js';

/** @typedef {import('../db/common.js').Db} Db */
/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('../repo/eventAdminList.js').AdminEventRow} AdminEventRow */
/** @typedef {import('../repo/eventAdminList.js').AdminEvent} AdminEvent */
/** @typedef {import('../repo/eventAdminList.js').EventEntry} EventEntry */

/** The event list page's page size (`GET /api/owner/events`). */
export const EVENT_PAGE_SIZE = 50;

/**
 * The event list page: every event matching `q`, newest `occurredOn`
 * first, page size fixed at `EVENT_PAGE_SIZE`.
 * @param {{ db: Db }} deps @param {{ q: string, offset: number }} query
 * @returns {Promise<{ events: AdminEventRow[], total: number }>}
 */
export async function adminEventList(deps, { q, offset }) {
  return listAdminEvents(deps.db, { q, limit: EVENT_PAGE_SIZE, offset });
}

/** @param {import('../http/contracts.js').EventPersonOption[]} people @param {string[]} platforms */
function optionsOf(people, platforms) {
  return { people, platforms: platforms.map((code) => ({ code, name: code })) };
}

/**
 * One event plus the edit form's options (people, live platforms); `null`
 * for an unknown or merged-away event (the route answers 404).
 * @param {{ db: Db }} deps @param {number} id
 * @returns {Promise<(AdminEvent & { options: { people: import('../http/contracts.js').EventPersonOption[], platforms: { code: string, name: string }[] } }) | null>}
 */
export async function adminEventDetail(deps, id) {
  const event = await getAdminEvent(deps.db, id);
  if (!event || event.mergedInto !== null) return null;
  const [people, platforms] = await Promise.all([listPeople(deps.db), listPlatforms(deps.db)]);
  return { ...event, options: optionsOf(people.map((p) => ({ id: p.id, displayName: p.displayName, emoji: p.emoji, igHandle: p.igHandle })), platforms) };
}

/** @param {AdminEvent} event @returns {AdminEventRow} */
function rowOf({ id, slug, name, occurredOn, entryCount, people, hidden, addressLocked }) {
  return { id, slug, name, occurredOn, entryCount, people, hidden, addressLocked };
}

/**
 * The preview's first text line, trimmed, at most 120 characters; `''`
 * when `entry` has no preview (Ruling R6/R6a).
 * @param {{ preview: import('../http/contracts.js').Preview } | undefined} entry
 * @returns {string}
 */
function snippetOf(entry) {
  const line = entry?.preview.lines.find((l) => 'text' in l && l.text.trim() !== '');
  return line && 'text' in line ? line.text.trim().slice(0, 120) : '';
}

/**
 * One event's entries, each with a `snippet`; `null` for an unknown or
 * merged-away event (the route answers 404), as `adminEventDetail`.
 * @param {ViewDeps} deps @param {number} eventId
 * @returns {Promise<{ event: AdminEventRow, entries: (EventEntry & { snippet: string })[] } | null>}
 */
export async function adminEventEntries(deps, eventId) {
  const event = await getAdminEvent(deps.db, eventId);
  if (!event || event.mergedInto !== null) return null;
  const entries = await listEventEntries(deps.db, eventId);
  const ctx = await presenterContext(deps);
  const previews = await previewsForAny(deps, entries.map((entry) => entry.itemId), ctx);
  const byId = new Map(previews.map((entry) => [entry.card.id, entry]));
  return { event: rowOf(event), entries: entries.map((entry) => ({ ...entry, snippet: snippetOf(byId.get(entry.itemId)) })) };
}
