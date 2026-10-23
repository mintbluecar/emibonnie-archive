// @ts-check
/**
 * tags: hashtags and keywords, keyed by `(kind, norm)`
 * (`domain/text.js#norm` is the only function that computes `norm`, so a
 * tag stored here and one looked up in SQL always agree).
 */
import { norm } from '../domain/text.js';

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */

/**
 * @param {Tx} tx
 * @param {'hashtag'|'keyword'} kind
 * @param {string} display
 * @returns {Promise<number>}
 */
async function ensureOneTag(tx, kind, display) {
  const normed = norm(display);
  const inserted = await tx.query(
    'insert into tags (kind, display, norm) values ($1, $2, $3) on conflict (kind, norm) do nothing returning id',
    [kind, display, normed],
  );
  if (inserted.rows[0]) return inserted.rows[0].id;
  const existing = await tx.query('select id from tags where kind = $1 and norm = $2', [kind, normed]);
  return existing.rows[0].id;
}

/**
 * @param {Tx} tx
 * @param {{ kind: 'hashtag'|'keyword', display: string }[]} items
 * @returns {Promise<number[]>}
 */
export async function ensureTags(tx, items) {
  /** @type {number[]} */
  const ids = [];
  for (const { kind, display } of items) {
    ids.push(await ensureOneTag(tx, kind, display));
  }
  return ids;
}

/** @param {Tx} db @returns {Promise<string[]>} */
export async function ignoredHashtags(db) {
  const { rows } = await db.query("select display from tags where kind = 'hashtag' and ignored order by id");
  return rows.map((row) => row.display);
}

/**
 * Adds a tag row, ignored, for each hashtag in `list` that has no row yet
 * (by `norm`). An existing row — ignored or not — is left alone.
 * @param {Tx} tx
 * @param {string[]} list
 * @returns {Promise<void>}
 */
export async function setIgnoredIfMissing(tx, list) {
  for (const display of list) {
    await tx.query(
      "insert into tags (kind, display, norm, ignored) values ('hashtag', $1, $2, true) on conflict (kind, norm) do nothing",
      [display, norm(display)],
    );
  }
}

/**
 * Ensures each tag and links it to the item. Idempotent.
 * @param {Tx} tx
 * @param {number} itemId
 * @param {{ kind: 'hashtag'|'keyword', display: string }[]} items
 * @returns {Promise<number[]>} the tag ids
 */
export async function tagItem(tx, itemId, items) {
  const tagIds = await ensureTags(tx, items);
  for (const tagId of new Set(tagIds)) {
    await tx.query('insert into item_tags (item_id, tag_id) values ($1, $2) on conflict (item_id, tag_id) do nothing', [itemId, tagId]);
  }
  return tagIds;
}
