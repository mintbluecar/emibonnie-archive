// @ts-check
/**
 * The owner's event admin (spec ②): editing an event's own fields,
 * merging events into one, and creating an event out of another's
 * entries. Each is one `write`: the fields' shape is checked first
 * (`eventFields.js`), then, inside the transaction, the events involved
 * are locked and re-checked, so a stale tab gets 400/409 and nothing is
 * written. Changing an event's date never touches its entries' dates.
 */
import { BadRequest, Conflict, NotFound } from '../domain/errors.js';
import { HOME_TAG, SEARCH_TAG, eventTag } from '../domain/cacheTags.js';
import {
  lockEvents, lockLiveItemsOf, markMerged, moveDeletedItems, replaceEventTags, replaceLivePeople, updateEventFields,
} from '../repo/eventAdmin.js';
import { createEvent } from '../repo/events.js';
import { addressFor, checkFields, checkIds, liveEvents } from './eventFields.js';
import { moveInto, requireEntriesOf } from './eventMoves.js';
import { write } from './write.js';

/** @typedef {import('./eventFields.js').EventFields} EventFields */
/** @typedef {import('./eventFields.js').EventState} EventState */
/** @typedef {import('./write.js').WriteDeps} WriteDeps */
/** @typedef {import('./session.js').SessionUser} SessionUser */
/** @typedef {import('../db/common.js').Tx} Tx */

/**
 * Writes the checked fields onto an existing event, readdressing it
 * unless it's locked (`addressFor`).
 * @param {Tx} tx @param {EventState} event @param {EventFields} fields @returns {Promise<string>} its slug now
 */
async function saveFields(tx, event, fields) {
  const slug = await addressFor(tx, event, fields);
  await updateEventFields(tx, event.id, { name: fields.name, occurredOn: fields.occurredOn, slug, livePlatformCode: fields.livePlatformCode });
  await replaceEventTags(tx, event.id, { keywords: fields.keywords, hashtags: fields.hashtags });
  await replaceLivePeople(tx, event.id, fields.livePeopleIds);
  return slug;
}

/**
 * Edit mode: the event's name, date, tags, live details and (until it's
 * locked) its address. `NotFound` for an unknown event, `Conflict('merged')`
 * for a merged-away one.
 * @param {WriteDeps} deps @param {{ eventId: number, fields: EventFields, actor: SessionUser }} input
 * @returns {Promise<{ slug: string }>}
 */
export async function editEvent(deps, { eventId, fields, actor }) {
  const checked = await checkFields(deps.db, fields);
  return write(deps, actor.id, async (w) => {
    const event = (await lockEvents(w.tx, [eventId])).get(eventId);
    if (!event) throw new NotFound();
    if (event.mergedInto !== null) throw new Conflict('merged');
    const slug = await saveFields(w.tx, event, checked);
    w.purge.tags([eventTag(event.slug), eventTag(slug), HOME_TAG, SEARCH_TAG]);
    return { slug };
  });
}

/**
 * Merge mode: `keepId` takes `fields` (its tags as given: the page has
 * combined the merged events' already), every entry of `mergeIds` moves
 * into it, and each of `mergeIds` is marked merged into it, all in one
 * transaction. `markMerged` runs first, so the merged events' performer
 * and guest rows carry over while the form's live people are final
 * (Ruling R9). Deleted entries move too, with no edit row or purge, so a
 * later restore lands on a live event (Ruling R10).
 * @param {WriteDeps} deps @param {{ keepId: number, mergeIds: number[], fields: EventFields, actor: SessionUser }} input
 * @returns {Promise<{ slug: string, moved: number }>}
 */
export async function mergeEvents(deps, { keepId, mergeIds, fields, actor }) {
  checkIds([keepId], 'keepId');
  checkIds(mergeIds, 'mergeIds');
  if (mergeIds.includes(keepId)) throw new BadRequest('mergeIds lists the kept event');
  const checked = await checkFields(deps.db, fields);
  return write(deps, actor.id, async (w) => {
    const events = await liveEvents(w.tx, [keepId, ...mergeIds]);
    const itemIds = (await lockLiveItemsOf(w.tx, mergeIds)).map((item) => item.id);
    await markMerged(w.tx, { mergeIds, keepId });
    const slug = await saveFields(w.tx, /** @type {EventState} */ (events.get(keepId)), checked);
    const slugs = [...[...events.values()].map((event) => event.slug), slug];
    const moved = await moveInto(w, { itemIds, toEventId: keepId, slugs });
    await moveDeletedItems(w.tx, { fromEventIds: mergeIds, toEventId: keepId });
    return { slug, moved };
  });
}

/**
 * Create mode: a new event with `fields` (addressed like any unlocked
 * event), and `itemIds` -- entries of `fromEventId` now -- moved into it,
 * in one transaction; on any refusal nothing is created. An unknown
 * `fromEventId` (the route's path id) is `NotFound`.
 * @param {WriteDeps} deps @param {{ fromEventId: number, itemIds: number[], fields: EventFields, actor: SessionUser }} input
 * @returns {Promise<{ eventId: number, slug: string, moved: number }>}
 */
export async function createEventWithEntries(deps, { fromEventId, itemIds, fields, actor }) {
  checkIds([fromEventId], 'fromEventId');
  checkIds(itemIds, 'itemIds');
  const checked = await checkFields(deps.db, fields);
  return write(deps, actor.id, async (w) => {
    const from = /** @type {EventState} */ ((await liveEvents(w.tx, [fromEventId], fromEventId)).get(fromEventId));
    await requireEntriesOf(w, fromEventId, itemIds);
    const slug = await addressFor(w.tx, null, checked);
    const event = await createEvent(w.tx, { ...checked, slug });
    const moved = await moveInto(w, { itemIds, toEventId: event.id, slugs: [from.slug, slug] });
    return { eventId: event.id, slug, moved };
  });
}
