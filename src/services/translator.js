// @ts-check
/**
 * A translator's own view (Plan 2b): "my translations" -- every item
 * credited to one of their linked X accounts, in any review state, with
 * removed entries kept for restore -- their totals for the one-time
 * welcome, and the flag that shows that welcome once.
 */
import { BadRequest, Conflict, Forbidden } from '../domain/errors.js';
import {
  findItemIdBySource, restoreItem, translatorItemIds, translatorStates, translatorTotals,
} from '../repo/itemState.js';
import { getItem } from '../repo/items.js';
import { kindNamed, presenterContext, previewsForAny } from './cards.js';
import { write } from './write.js';
import { remove } from './itemLifecycle.js';

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
 * @param {{ db: import('../db/common.js').Db, now: () => Date }} deps
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function markWelcomed(deps, userId) {
  await deps.db.transaction(
    (tx) => tx.query(
      "update users set meta = meta || jsonb_build_object('translatorWelcomedAt', $2::text) where id = $1 and meta->>'translatorWelcomedAt' is null",
      [userId, deps.now().toISOString()],
    ),
    { actor: userId },
  );
}

/** The reason a translator's own removal carries; the only one they may undo. */
const REMOVED_BY_ACCOUNT = 'removed_by_account';
/** One request may remove or restore this many entries. */
const MAX_BATCH = 50;

/**
 * One batch entry as a registered kind and its source id.
 * @param {import('./cards.js').KindsDeps} deps @param {any} raw
 * @returns {{ kind: any, sourceId: string }}
 */
function entryOf(deps, raw) {
  const kind = kindNamed(deps, String(raw?.kind ?? ''));
  const sourceId = typeof raw?.sourceId === 'string' ? raw.sourceId : '';
  if (!kind || sourceId === '') throw new BadRequest(`unknown item: ${String(raw?.sourceId ?? '')}`);
  return { kind, sourceId };
}

/**
 * The item one entry names, with the caller's ownership checked: only an
 * item credited to one of their linked X accounts is theirs to change.
 * @param {import('../db/common.js').Db} db @param {SessionUser} user
 * @param {{ kind: any, sourceId: string }} entry
 * @returns {Promise<{ id: number, reason: string|null }>}
 */
async function ownedTarget(db, user, { kind, sourceId }) {
  const id = await findItemIdBySource(db, { kind: kind.name, platform: kind.platform, externalId: sourceId });
  if (id === null) throw new BadRequest(`unknown item: ${sourceId}`);
  const item = /** @type {any} */ (await getItem(db, id));
  if (!item) throw new BadRequest(`unknown item: ${sourceId}`);
  if (item.creditedAccountId === null || !user.translatorAccountIds.includes(item.creditedAccountId)) {
    throw new Forbidden('forbidden');
  }
  return { id, reason: item.deletedReason ?? null };
}

/**
 * The resolved, owned targets of a batch, all validated before anything
 * changes: one unknown or foreign entry refuses the whole batch.
 * @param {ViewDeps} deps @param {SessionUser} user @param {unknown} entries
 * @returns {Promise<{ id: number, reason: string|null }[]>}
 */
async function resolveOwned(deps, user, entries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_BATCH) {
    throw new BadRequest(`items must be 1-${MAX_BATCH} entries`);
  }
  /** @type {{ id: number, reason: string|null }[]} */
  const targets = [];
  for (const raw of /** @type {any[]} */ (entries)) targets.push(await ownedTarget(deps.db, user, entryOf(deps, raw)));
  return targets;
}

/**
 * Removes the caller's own entries (Plan 2b): one transaction, all or
 * nothing, then the CDN purge for every entry that changed. An entry
 * already removed is a no-op.
 * @param {ViewDeps & { env?: Record<string, string|undefined> }} deps
 * @param {SessionUser} user
 * @param {unknown} entries `{ kind, sourceId }[]`, 1 to 50
 * @returns {Promise<{ removed: number }>}
 */
export async function removeEntries(deps, user, entries) {
  const targets = await resolveOwned(deps, user, entries);
  const removed = await write(deps, user.id, async (w) => {
    let n = 0;
    for (const target of targets) {
      if (await remove(w, { itemId: target.id, reason: REMOVED_BY_ACCOUNT })) n += 1;
    }
    return n;
  });
  return { removed };
}

/**
 * Restores entries the caller removed themselves. Only
 * `removed_by_account` is theirs to undo; a hide or a block stays the
 * owner's, so a batch containing one changes nothing.
 * @param {ViewDeps & { env?: Record<string, string|undefined> }} deps
 * @param {SessionUser} user
 * @param {unknown} entries `{ kind, sourceId }[]`, 1 to 50
 * @returns {Promise<{ restored: number }>}
 */
export async function restoreEntries(deps, user, entries) {
  const targets = await resolveOwned(deps, user, entries);
  if (targets.some((target) => target.reason !== REMOVED_BY_ACCOUNT)) throw new Conflict('not_removed_by_you');
  const restored = await write(deps, user.id, async (w) => {
    let n = 0;
    for (const target of targets) {
      if (!(await restoreItem(w.tx, { itemId: target.id, reason: REMOVED_BY_ACCOUNT }))) continue;
      w.purge.item(target.id);
      n += 1;
    }
    return n;
  });
  return { restored };
}

/**
 * Opts every X account linked to the caller out (or back in). Nothing is
 * soft-deleted: `accounts.opted_out_at` already hides the credited items
 * everywhere, and clearing it restores exactly those. Returns how many
 * entries the change affects, for the opt-out box's count.
 * @param {ViewDeps & { env?: Record<string, string|undefined> }} deps
 * @param {SessionUser} user
 * @param {boolean} optedOut
 * @returns {Promise<{ optedOut: boolean, entries: number }>}
 */
export async function setOptOut(deps, user, optedOut) {
  const accounts = user.translatorAccountIds;
  if (accounts.length === 0) throw new Forbidden('not_a_translator');
  const { rows } = await write(deps, user.id, async (w) => {
    await w.tx.query(
      'update accounts set opted_out_at = case when $2 then now() else null end where id = any($1::bigint[])',
      [accounts, optedOut],
    );
    for (const accountId of accounts) (optedOut ? w.purge.accountRemoved : w.purge.account)(accountId);
    return w.tx.query(
      `select count(*)::int as n from items
       where credited_account_id = any($1::bigint[])
         and (deleted_reason is null or deleted_reason <> 'erased')`,
      [accounts],
    );
  });
  return { optedOut, entries: rows[0].n };
}
