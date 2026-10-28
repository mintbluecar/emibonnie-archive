// @ts-check
/**
 * The owner's tools until Plan 3's admin (Plan 2b): the approval switch,
 * the waiting list and reviewing held entries. The owner section of the
 * me page reads `ownerView`; every route behind it is owner-only.
 */
import { BadRequest } from '../domain/errors.js';
import { pendingItemIds, findItemIdBySource, setReviewState } from '../repo/itemState.js';
import { get as settingsGet, set as settingsSet } from '../repo/settings.js';
import { kindsOf, presenterContext, previewsForAny } from './cards.js';
import { purgeItem } from './cache.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('./session.js').SessionUser} SessionUser */
/** @typedef {import('../http/contracts.js').OwnerView} OwnerView */
/** @typedef {import('../domain/constants.js').ReviewState} ReviewState */

/** How many held entries the waiting list shows. */
export const WAITING_LIMIT = 50;

/**
 * Everything the owner section shows in one request: the switch, the X
 * sign-in failure note, the held entries and (Task 9) the report queue.
 * @param {ViewDeps} deps
 * @returns {Promise<OwnerView>}
 */
export async function ownerView(deps) {
  const [approvalRequired, signInFailedAt, ids] = await Promise.all([
    settingsGet(deps.db, 'approvalRequired').then((value) => value === true),
    settingsGet(deps.db, 'xSignInFailedAt'),
    pendingItemIds(deps.db, { limit: WAITING_LIMIT }),
  ]);
  const ctx = await presenterContext(deps);
  const entries = await previewsForAny(deps, ids, ctx);
  return {
    approvalRequired,
    signInFailedAt: typeof signInFailedAt === 'string' ? signInFailedAt : null,
    waiting: entries.map(({ card, preview }) => ({ ...preview, reviewState: card.reviewState })),
    reports: [],
  };
}

/**
 * Turns the approval switch on or off. Idempotent; audited as a setting.
 * @param {{ db: import('../db/common.js').Db }} deps
 * @param {boolean} required
 * @param {string} actor
 * @returns {Promise<{ approvalRequired: boolean }>}
 */
export async function setApproval(deps, required, actor) {
  const value = required === true;
  await deps.db.transaction((tx) => settingsSet(tx, 'approvalRequired', value), { actor });
  return { approvalRequired: value };
}

/**
 * Publishes or rejects one held (or live) entry. A rejected entry leaves
 * the public surfaces through the existing visibility rule and stays in
 * its submitter's "added by me" list. Both outcomes purge the entry.
 * @param {ViewDeps & { env?: Record<string, string|undefined> }} deps
 * @param {{ kind: string, sourceId: string, state: ReviewState, actor: SessionUser }} input
 * @returns {Promise<{ state: ReviewState }>}
 */
export async function reviewItem(deps, { kind: kindName, sourceId, state, actor }) {
  if (state !== 'published' && state !== 'rejected') throw new BadRequest('state must be published or rejected');
  const kinds = kindsOf(deps);
  const kind = Object.hasOwn(kinds, kindName) ? kinds[kindName] : undefined;
  if (!kind) throw new BadRequest(`unknown kind: ${kindName}`);
  const id = await findItemIdBySource(deps.db, { kind: kind.name, platform: kind.platform, externalId: sourceId });
  if (id === null) throw new BadRequest(`unknown item: ${sourceId}`);
  await deps.db.transaction((tx) => setReviewState(tx, { itemId: id, state }), { actor: actor.id });
  await purgeItem(deps, id);
  return { state };
}
