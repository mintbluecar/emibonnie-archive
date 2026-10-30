// @ts-check
/**
 * The state changes owner review and import share, each inside a
 * `write()` so the item, its held parts and the caller's own rows commit
 * together and the purge runs after commit.
 *
 * `part` is one held follow-up, named by its source's external id (what
 * an import row carries and what the kind's `reviewHeld` scopes by):
 * with it, only that part changes and the item's own state is untouched.
 * `keepHeld` (a whole-item publish only) names held follow-ups left held.
 */
import { setReviewState, softDeleteItem } from '../repo/itemState.js';
import { kindNamed } from './cards.js';

/** @typedef {import('./write.js').Write} Write */

/**
 * @param {Write} w @param {{ itemId: number, kindName: string, part?: string, keepHeld?: string[], approve: boolean }} input
 * @returns {Promise<void>}
 */
async function review(w, { itemId, kindName, part, keepHeld = [], approve }) {
  if (part === undefined) await setReviewState(w.tx, { itemId, state: approve ? 'published' : 'rejected' });
  const kind = kindNamed(w, kindName);
  if (typeof kind?.reviewHeld === 'function') {
    const scope = part === undefined ? (keepHeld.length > 0 ? { keepSourceIds: keepHeld } : {}) : { sourceId: part };
    await kind.reviewHeld(w.tx, { itemId, approve, ...scope });
  }
}

/**
 * Publishes the item and every held part (but those in `keepHeld`), or
 * only `part`.
 * @param {Write} w @param {{ itemId: number, kindName: string, part?: string, keepHeld?: string[] }} input
 * @returns {Promise<void>}
 */
export async function publish(w, { itemId, kindName, part, keepHeld }) {
  await review(w, { itemId, kindName, part, keepHeld, approve: true });
  w.purge.item(itemId);
}

/**
 * Rejects the item and every held part, or only `part`. A rejected item
 * leaves the public pages; a rejected held part was never on them, so it
 * purges nothing.
 * @param {Write} w @param {{ itemId: number, kindName: string, part?: string }} input
 * @returns {Promise<void>}
 */
export async function reject(w, { itemId, kindName, part }) {
  await review(w, { itemId, kindName, part, approve: false });
  if (part === undefined) w.purge.itemRemoved(itemId);
}

/**
 * Soft-deletes the item with `reason`, by `w.actor`. An item already
 * removed is a no-op.
 * @param {Write} w @param {{ itemId: number, reason: string }} input
 * @returns {Promise<boolean>} whether the item changed
 */
export async function remove(w, { itemId, reason }) {
  const changed = await softDeleteItem(w.tx, { itemId, reason, actor: w.actor });
  if (changed) w.purge.itemRemoved(itemId);
  return changed;
}
