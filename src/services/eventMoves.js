// @ts-check
/**
 * Moving entries between events, and each move's history: an
 * `item_edits` row per moved entry (the same shape the entry edit page
 * writes, `src/repo/itemEdits.js`) and the purges that keep both events'
 * pages and the entry's own page fresh. `moveInto` is shared with merge
 * and create (`eventAdmin.js`); `moveEntries` is ③'s "Move ticked to".
 */
import { BadRequest } from '../domain/errors.js';
import { HOME_TAG, SEARCH_TAG, eventTag, itemTag } from '../domain/cacheTags.js';
import { lockLiveItemsOf, moveItemsToEvent } from '../repo/eventAdmin.js';
import { insertItemEdit } from '../repo/itemEdits.js';
import { itemChangeTags } from './cache.js';
import { checkIds, liveEvents } from './eventFields.js';
import { write } from './write.js';

/** @typedef {import('./write.js').Write} Write */
/** @typedef {import('./write.js').WriteDeps} WriteDeps */
/** @typedef {import('./session.js').SessionUser} SessionUser */

/** @param {Write} w @param {number[]} itemIds @returns {Promise<string[]>} every tag the items' pages carry now */
async function tagsOf(w, itemIds) {
  const tags = [];
  for (const id of itemIds) tags.push(...(await itemChangeTags(/** @type {any} */ (w.tx), id)));
  return tags;
}

/**
 * Inside an open write: moves `itemIds` into `toEventId`, records each
 * move as an `item_edits` row (`eventId` before and after) by `w.actor`,
 * and queues the purges: every tag the items carried before and after,
 * the events named by `slugs`, home and search, and each entry's own
 * page (`itemEdited`). The caller has checked the items and events.
 * @param {Write} w @param {{ itemIds: number[], toEventId: number, slugs: string[] }} move
 * @returns {Promise<number>} how many entries moved
 */
export async function moveInto(w, { itemIds, toEventId, slugs }) {
  const before = await tagsOf(w, itemIds);
  const moved = await moveItemsToEvent(w.tx, { itemIds, toEventId });
  for (const { itemId, fromEventId } of moved) {
    await insertItemEdit(w.tx, { itemId, before: { eventId: fromEventId }, after: { eventId: toEventId }, reverts: null, createdBy: w.actor });
  }
  const after = await tagsOf(w, itemIds);
  // An entry's own page is deleted by `itemEdited`, not invalidated.
  const own = new Set(itemIds.map(itemTag));
  const tags = new Set([...before, ...after, ...slugs.map(eventTag), HOME_TAG, SEARCH_TAG]);
  w.purge.tags([...tags].filter((tag) => !own.has(tag)));
  for (const id of itemIds) w.purge.itemEdited(id);
  return moved.length;
}

/**
 * Inside an open write: refuses (`BadRequest`) unless every one of
 * `itemIds` is a non-deleted entry of `eventId` right now, locking them.
 * @param {Write} w @param {number} eventId @param {number[]} itemIds @returns {Promise<void>}
 */
export async function requireEntriesOf(w, eventId, itemIds) {
  const inEvent = new Set((await lockLiveItemsOf(w.tx, [eventId])).map((item) => item.id));
  if (!itemIds.every((id) => inEvent.has(id))) throw new BadRequest('an entry is not in that event any more');
}

/**
 * ③'s "Move ticked to": moves entries of `fromEventId` into another
 * existing event, in one transaction. An unknown `fromEventId` (the
 * route's path id) is `NotFound`; an unknown `toEventId` `BadRequest`.
 * @param {WriteDeps} deps
 * @param {{ fromEventId: number, itemIds: number[], toEventId: number, actor: SessionUser }} input
 * @returns {Promise<{ moved: number }>}
 */
export async function moveEntries(deps, { fromEventId, itemIds, toEventId, actor }) {
  checkIds([fromEventId], 'fromEventId');
  checkIds([toEventId], 'toEventId');
  checkIds(itemIds, 'itemIds');
  if (toEventId === fromEventId) throw new BadRequest('the entries are already in that event');
  const moved = await write(deps, actor.id, async (w) => {
    const events = await liveEvents(w.tx, [fromEventId, toEventId], fromEventId);
    await requireEntriesOf(w, fromEventId, itemIds);
    const slugs = [fromEventId, toEventId].map((id) => /** @type {{ slug: string }} */ (events.get(id)).slug);
    return moveInto(w, { itemIds, toEventId, slugs });
  });
  return { moved };
}
