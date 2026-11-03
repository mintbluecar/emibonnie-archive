// @ts-check
/**
 * `npm run readdress-events -- [--dry-run]`
 *
 * One-off: a database from before Tasks 1-3 still holds one-part event
 * slugs (e.g. `moon-gala-with-juniper-2025-10-04`), from when `/e/<slug>`
 * had no date half. This rewrites every one of them to the current
 * two-part address (`YYYY-MM-DD/<tag>`, `src/domain/eventAddress.js`),
 * then backfills `address_locked_at` on events the `lock_event_address`
 * trigger (migration 006) never ran for, because their entries published
 * before that trigger existed. Run once per site, after migrating --
 * `--dry-run` first, which prints old -> new and writes nothing.
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { addressOf, defaultAddressTag, withClashSuffix } from '../src/domain/eventAddress.js';
import { runCli } from './cli.js';

/**
 * An event's hashtags, in `tags.id` order -- the same order
 * `src/repo/events.js`'s `SELECT` builds its `hashtags` list in.
 * @param {import('../src/db/common.js').Tx} tx @param {number} eventId
 * @returns {Promise<string[]>}
 */
async function hashtagsOf(tx, eventId) {
  const { rows } = await tx.query(
    `select t.display from event_tags et join tags t on t.id = et.tag_id
     where et.event_id = $1 and t.kind = 'hashtag' order by t.id`,
    [eventId],
  );
  return rows.map((row) => row.display);
}

/**
 * Every event with a one-part slug (no `/`), oldest id first; deleted
 * events included, since their old slugs still count as taken.
 * @param {import('../src/db/common.js').Tx} tx
 */
async function onePartEvents(tx) {
  const { rows } = await tx.query("select id, slug, name, occurred_on from events where slug !~ '/' order by id");
  return rows;
}

/**
 * Readdresses one event: the new slug, computed from its hashtags
 * (`defaultAddressTag`/`addressOf`) and de-clashed against `taken`, which
 * grows with each new slug so two events sharing a date and tag don't
 * collide with each other either.
 * @param {import('../src/db/common.js').Tx} tx
 * @param {{ id: number, slug: string, name: string, occurred_on: string }} event
 * @param {Set<string>} taken
 * @param {{ dryRun: boolean, log: (line: string) => void }} options
 */
async function readdressOne(tx, event, taken, { dryRun, log }) {
  const hashtags = await hashtagsOf(tx, event.id);
  const addressTag = defaultAddressTag({ hashtags, name: event.name });
  const address = addressOf({ occurredOn: event.occurred_on, addressTag });
  const newSlug = withClashSuffix(address, taken);
  taken.add(newSlug);
  if (dryRun) log(`${event.slug} -> ${newSlug}`);
  else await tx.query('update events set slug = $1 where id = $2', [newSlug, event.id]);
}

/** Every event's slug, deleted included -- what a new address must avoid clashing with. */
async function allSlugs(/** @type {import('../src/db/common.js').Tx} */ tx) {
  const { rows } = await tx.query('select slug from events');
  return new Set(/** @type {string[]} */ (rows.map((row) => row.slug)));
}

/**
 * Locks every event that has a published, non-deleted entry and no lock
 * yet -- what `lock_event_address` (migration 006) would have stamped
 * already, had it existed when those entries published. `dryRun` only
 * counts them.
 * @param {import('../src/db/common.js').Tx} tx @param {boolean} dryRun
 * @returns {Promise<number>}
 */
async function lockPublishedEvents(tx, dryRun) {
  const where = `e.address_locked_at is null and exists (
    select 1 from items i where i.event_id = e.id and i.review_state = 'published' and i.deleted_at is null
  )`;
  if (dryRun) {
    const { rows } = await tx.query(`select count(*)::int as n from events e where ${where}`);
    return rows[0].n;
  }
  const { rowCount } = await tx.query(`update events e set address_locked_at = now() where ${where}`);
  return rowCount ?? 0;
}

/**
 * @param {import('../src/db/common.js').Db} db
 * @param {{ dryRun?: boolean, log?: (line: string) => void }} [options]
 * @returns {Promise<{ changed: number, locked: number }>}
 */
export async function readdressEvents(db, { dryRun = false, log = console.log } = {}) {
  return db.transaction(async (tx) => {
    const events = await onePartEvents(tx);
    const taken = await allSlugs(tx);
    for (const event of events) await readdressOne(tx, event, taken, { dryRun, log });
    const locked = await lockPublishedEvents(tx, dryRun);
    return { changed: events.length, locked };
  }, { actor: 'system' });
}

function main() {
  return runCli(async ({ db, log }) => {
    const { 'dry-run': dryRun } = parseArgs({ args: process.argv.slice(2), options: { 'dry-run': { type: 'boolean' } }, allowPositionals: false }).values;
    const result = await readdressEvents(/** @type {import('../src/db/common.js').Db} */ (db), { dryRun: Boolean(dryRun), log });
    log(`${result.changed} readdressed, ${result.locked} locked${dryRun ? ' (dry run: nothing written)' : ''}`);
  }, { db: 'required' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
