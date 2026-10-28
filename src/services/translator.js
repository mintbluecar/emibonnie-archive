// @ts-check
/**
 * A translator's own view (Plan 2b): "my translations" -- every item
 * credited to one of their linked X accounts, in any review state, with
 * removed entries kept for restore -- their totals for the one-time
 * welcome, and the flag that shows that welcome once.
 */
import { translatorItemIds, translatorStates, translatorTotals } from '../repo/itemState.js';
import { presenterContext, previewsForAny } from './cards.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('./session.js').SessionUser} SessionUser */
/** @typedef {import('../http/contracts.js').TranslatorList} TranslatorList */

/** How many entries one page of "my translations" holds. */
export const TRANSLATOR_PAGE_SIZE = 20;

/**
 * One page of the caller's credited entries, newest first, plus their
 * totals. `removedByYou` marks a row the translator may restore;
 * `hidden` marks every other removal (the owner's hide, a block, spam),
 * which only the owner can undo.
 * @param {ViewDeps} deps
 * @param {SessionUser} user
 * @param {{ offset: number }} page
 * @returns {Promise<TranslatorList>}
 */
export async function translatorList(deps, user, { offset }) {
  const accounts = user.translatorAccountIds;
  const { ids, hasMore } = await translatorItemIds(deps.db, accounts, { limit: TRANSLATOR_PAGE_SIZE, offset });
  const ctx = await presenterContext(deps);
  const [entries, states, totals] = await Promise.all([
    previewsForAny(deps, ids, ctx),
    translatorStates(deps.db, ids),
    translatorTotals(deps.db, accounts),
  ]);
  return {
    items: entries.map(({ card, preview }) => {
      const state = states.get(card.id);
      const removedByYou = state?.reason === 'removed_by_account';
      return {
        ...preview,
        reviewState: card.reviewState,
        removedByYou,
        hidden: state?.reason != null && !removedByYou,
      };
    }),
    hasMore,
    totals,
  };
}

/**
 * Records that the one-time translator welcome has been shown, merging
 * into `users.meta` so a stored X handle survives.
 * @param {{ db: import('../db/common.js').Db }} deps
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function markWelcomed(deps, userId) {
  await deps.db.transaction(
    (tx) => tx.query(
      "update users set meta = meta || jsonb_build_object('translatorWelcomedAt', $2::text) where id = $1",
      [userId, new Date().toISOString()],
    ),
    { actor: userId },
  );
}
