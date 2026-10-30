// @ts-check
/**
 * `write(deps, actor, fn)`: the one way a service changes public data.
 * `fn` runs inside `deps.db.transaction(…, { actor })` and queues the CDN
 * purges its change needs on `w.purge`; they run only after the
 * transaction commits (a rollback drops them), through `cache.js`, which
 * computes the tags and hands the purge call to `deps.defer`.
 *
 * A change (`item`, `account`, `tags`) invalidates: the CDN may serve the
 * page stale once while it refreshes (browsers always revalidate with the
 * CDN, src/http/handler.js `splitForCdn`, so the CDN's copy is what they
 * get). A removal (`itemRemoved`, `accountRemoved`) deletes, so the removed
 * content is never served again (see cache.js `purgeTags`). An edit
 * (`itemEdited`) deletes the entry's own page, so the editor reopening it
 * sees the edit, and invalidates the pages it appears on.
 */
import { purgeAccount, purgeEditedItem, purgeForTags, purgeItem } from './cache.js';

/** @typedef {import('../db/common.js').Tx} Tx */
/** @typedef {import('./cache.js').CacheDeps & import('./cards.js').KindsDeps} WriteDeps */

/**
 * @typedef {object} Purges
 * @property {(itemId: number) => void} item an item changed
 * @property {(itemId: number) => void} itemRemoved an item left the public pages
 * @property {(itemId: number) => void} itemEdited an item's own fields were edited
 * @property {(accountId: number) => void} account a translator came back
 * @property {(accountId: number) => void} accountRemoved a translator left the public pages
 * @property {(tags: string[]) => void} tags explicit tags changed
 */

/**
 * What `fn` receives: the transaction, its actor (for audit columns such
 * as `deleted_by`), the kinds lookup and the purge queue.
 * @typedef {{ tx: Tx, actor: string, kinds: WriteDeps['kinds'], purge: Purges }} Write
 */

/**
 * @template T
 * @param {WriteDeps} deps
 * @param {string} actor
 * @param {(w: Write) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function write(deps, actor, fn) {
  /** @type {(() => Promise<void>)[]} */
  const queued = [];
  /** @type {Purges} */
  const purge = {
    item: (itemId) => { queued.push(() => purgeItem(deps, itemId)); },
    itemRemoved: (itemId) => { queued.push(() => purgeItem(deps, itemId, { hard: true })); },
    itemEdited: (itemId) => { queued.push(() => purgeEditedItem(deps, itemId)); },
    account: (accountId) => { queued.push(() => purgeAccount(deps, accountId)); },
    accountRemoved: (accountId) => { queued.push(() => purgeAccount(deps, accountId, { hard: true })); },
    tags: (tags) => { queued.push(() => purgeForTags(deps, tags)); },
  };
  const result = await deps.db.transaction((tx) => fn({ tx, actor, kinds: deps.kinds, purge }), { actor });
  for (const run of queued) await run();
  return result;
}
