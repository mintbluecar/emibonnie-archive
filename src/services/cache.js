// @ts-check
/**
 * Cache purging (Plan 2b). Every write that changes a public page calls
 * `purgeItem`/`purgeAccount` after its transaction: the tags name the
 * same strings the pages carry (src/domain/cacheTags.js), and Vercel's
 * `invalidateByTag` marks them stale (served stale once, refreshed in the
 * background). Purging runs through the request's `defer` so the write's
 * response never waits for it, and a failure is logged and swallowed --
 * the write already happened and must not fail because the CDN said no.
 *
 * Off Vercel (`VERCEL` unset: local dev, tests, the CLI) it is a no-op.
 * See https://vercel.com/docs/caching/cdn-cache/purge and
 * https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package
 * (`invalidateByTag`), read 2026-10-28.
 */
import { HOME_TAG, SEARCH_TAG, accountTag, eventTag, itemTag, personTag } from '../domain/cacheTags.js';
import { findItemIdBySource } from '../repo/itemState.js';
import { kindNamed } from './cards.js';

/** @typedef {import('../db/common.js').Db} Db */
/** @typedef {{ db: Db, env?: Record<string, string|undefined>,
 *   invalidateByTag?: (tags: string[]) => Promise<void>,
 *   dangerouslyDeleteByTag?: (tags: string[], options?: { revalidationDeadlineSeconds?: number }) => Promise<void>,
 *   defer?: (task: () => Promise<unknown>) => void,
 *   log?: (line: string) => void }} CacheDeps */

/** The item's event, people and translator, as tag inputs. @typedef {{ id: number, eventSlug: string|null, personIds: number[], accountHandle: string|null }} TagData */

/** @param {Db} db @param {number} itemId @returns {Promise<TagData|null>} */
export async function itemTagData(db, itemId) {
  const { rows } = await db.query(
    `select i.id, e.slug as event_slug, a.handle as account_handle,
       (select array_agg(ip.person_id) from item_people ip where ip.item_id = i.id) as person_ids
     from items i
     left join events e on e.id = i.event_id
     left join accounts a on a.id = i.credited_account_id
     where i.id = $1`,
    [itemId],
  );
  const row = rows[0];
  return row
    ? { id: row.id, eventSlug: row.event_slug ?? null, personIds: row.person_ids ?? [], accountHandle: row.account_handle ?? null }
    : null;
}

/**
 * Everything one item's change can make stale: home and search (its
 * counts and presence), its own page, its event, its people and its
 * translator. A missing item still clears home and search.
 * @param {Db} db @param {number} itemId @returns {Promise<string[]>}
 */
export async function itemChangeTags(db, itemId) {
  const data = await itemTagData(db, itemId);
  if (!data) return [HOME_TAG, SEARCH_TAG];
  return [
    HOME_TAG, SEARCH_TAG, itemTag(data.id),
    ...(data.eventSlug ? [eventTag(data.eventSlug)] : []),
    ...data.personIds.map(personTag),
    ...(data.accountHandle ? [accountTag(data.accountHandle)] : []),
  ];
}

/**
 * A translator page plus every entry credited to the account (the whole
 * account hides on opt-out, so all of its items' event/person copies go
 * stale too).
 * @param {Db} db @param {number} accountId @returns {Promise<string[]>}
 */
export async function accountChangeTags(db, accountId) {
  const tags = [HOME_TAG, SEARCH_TAG];
  const { rows: accounts } = await db.query('select handle from accounts where id = $1', [accountId]);
  if (accounts[0]) tags.push(accountTag(accounts[0].handle));
  const { rows: items } = await db.query(
    `select id from items where credited_account_id = $1
       and (deleted_reason is null or deleted_reason <> 'erased')
     order by id`,
    [accountId],
  );
  for (const item of items) tags.push(...(await itemChangeTags(db, item.id)));
  return [...new Set(tags)];
}

/** How many tags one purge call carries (well under the 128-tag response cap). */
const PURGE_BATCH = 100;

/**
 * Purges `tags` on Vercel. No-op elsewhere; a failure is one log line per
 * batch, with no tags, path or headers.
 *
 * `hard` chooses deletion over invalidation. Vercel's `invalidateByTag`
 * marks content stale and serves it once more while revalidating, which is
 * fine for a new or edited entry but wrong for a removal: `dangerouslyDeleteByTag`
 * fetches from the origin on the next request, so removed content is never
 * served again (see https://vercel.com/docs/caching/cdn-cache/purge).
 * @param {CacheDeps} deps @param {string[]} tags
 * @param {{ hard?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function purgeTags(deps, tags, { hard = false } = {}) {
  const unique = [...new Set(tags)];
  if (unique.length === 0 || !deps.env?.VERCEL) return;
  const fn = hard
    ? deps.dangerouslyDeleteByTag ?? (await import('@vercel/functions')).dangerouslyDeleteByTag
    : deps.invalidateByTag ?? (await import('@vercel/functions')).invalidateByTag;
  for (let i = 0; i < unique.length; i += PURGE_BATCH) {
    await purgeBatch(deps, fn, unique.slice(i, i + PURGE_BATCH), hard);
  }
}

/**
 * One purge call; a rejection is logged once and swallowed.
 * @param {CacheDeps} deps
 * @param {(tags: string[], options?: { revalidationDeadlineSeconds?: number }) => Promise<void>} fn
 * @param {string[]} batch
 * @param {boolean} hard
 * @returns {Promise<void>}
 */
async function purgeBatch(deps, fn, batch, hard) {
  try {
    if (hard) await fn(batch, { revalidationDeadlineSeconds: 0 });
    else await fn(batch);
  } catch {
    (deps.log ?? console.error)('cache purge failed');
  }
}

/**
 * Purges an explicit tag list, deferred when the request can defer it.
 * @param {CacheDeps} deps @param {string[]} tags @param {{ hard?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function purgeForTags(deps, tags, options = {}) {
  await purgeWhenPossible(deps, tags, options);
}

/**
 * The item a kind and source id name, purged (never fails the caller).
 * @param {CacheDeps & { site?: any, kinds?: Record<string, any> }} deps
 * @param {string} kindName @param {string} sourceId @param {{ hard?: boolean }} [options]
 * @returns {Promise<void>}
 */
export async function purgeSource(deps, kindName, sourceId, options = {}) {
  const kind = kindNamed(deps, kindName);
  if (!kind) return;
  const id = await findItemIdBySource(deps.db, { kind: kind.name, platform: kind.platform, externalId: sourceId });
  if (id !== null) await purgeItem(deps, id, options);
}

/**
 * @param {CacheDeps} deps @param {string[]} tags @param {{ hard?: boolean }} [options]
 * @returns {Promise<void>}
 */
async function purgeWhenPossible(deps, tags, { hard = false } = {}) {
  if (typeof deps.defer === 'function') {
    deps.defer(() => purgeTags(deps, tags, { hard }));
    return;
  }
  await purgeTags(deps, tags, { hard });
}

/** @param {CacheDeps} deps @param {number} itemId @param {{ hard?: boolean }} [options] @returns {Promise<void>} */
export async function purgeItem(deps, itemId, options = {}) {
  await purgeWhenPossible(deps, await itemChangeTags(deps.db, itemId), options);
}

/** @param {CacheDeps} deps @param {number} accountId @param {{ hard?: boolean }} [options] @returns {Promise<void>} */
export async function purgeAccount(deps, accountId, options = {}) {
  await purgeWhenPossible(deps, await accountChangeTags(deps.db, accountId), options);
}
