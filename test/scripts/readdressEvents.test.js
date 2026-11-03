// @ts-check
/**
 * `npm run readdress-events` (scripts/readdressEvents.js): the one-off
 * rewrite of a database's old one-part event slugs to the two-part
 * dated address, plus the `address_locked_at` backfill it carries along.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { insertEvent, insertItem } from '../helpers/seed.js';
import { readdressEvents } from '../../scripts/readdressEvents.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;

/** @param {{ eventIds: number[], display: string }} options */
async function addHashtag(db, { eventIds, display }) {
  await db.transaction(async (tx) => {
    const { rows } = await tx.query(
      "insert into tags (kind, display, norm) values ('hashtag', $1, $1) returning id",
      [display],
    );
    for (const eventId of eventIds) {
      await tx.query('insert into event_tags (event_id, tag_id) values ($1, $2)', [eventId, rows[0].id]);
    }
  }, { actor: 'system' });
}

before(async () => {
  db = await freshDb();
});
after(async () => { await db.end(); });

test('readdressEvents rewrites one-part slugs to the two-part address, de-clashes duplicates, leaves two-part slugs alone, and locks published events', async () => {
  // No hashtag: falls back to the name.
  const noTagId = await db.transaction((tx) => insertEvent(tx, {
    slug: 'juniper-tiktok-live-2025-12-04', occurredOn: '2025-12-04',
  }), { actor: 'system' });
  await db.transaction((tx) => tx.query('update events set name = $1 where id = $2', ['Juniper TikTok Live', noTagId]), { actor: 'system' });

  // Two events sharing a date and the same hashtag: the older id gets
  // the plain address, the younger (already suffixed, from the old
  // clash scheme) gets the new scheme's "-2".
  const firstId = await db.transaction((tx) => insertEvent(tx, {
    slug: 'moon-gala-with-juniper-2025-10-04', occurredOn: '2025-10-04',
  }), { actor: 'system' });
  const secondId = await db.transaction((tx) => insertEvent(tx, {
    slug: 'moon-gala-with-juniper-2025-10-04-2', occurredOn: '2025-10-04',
  }), { actor: 'system' });
  await addHashtag(db, { eventIds: [firstId, secondId], display: 'MoonFest26xJuniperTomas' });

  // Already two-part: untouched.
  const alreadyAddressedId = await db.transaction((tx) => insertEvent(tx, {
    slug: '2026-01-01/already-addressed', occurredOn: '2026-01-01',
  }), { actor: 'system' });

  // A published, non-deleted entry: address_locked_at should end up set.
  // The live `lock_event_address` trigger (006) already stamps it on
  // insert, so null it back out to stand in for data from before that
  // trigger existed -- what this script's own backfill has to catch.
  await db.transaction((tx) => insertItem(tx, { eventId: noTagId, placement: 'event', reviewState: 'published' }), { actor: 'system' });
  await db.transaction((tx) => tx.query('update events set address_locked_at = null where id = $1', [noTagId]), { actor: 'system' });

  const result = await readdressEvents(db, { dryRun: false });
  assert.deepEqual(result, { changed: 3, locked: 1 });

  const { rows } = await db.query('select id, slug, address_locked_at from events order by id');
  const bySlug = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(bySlug[noTagId].slug, '2025-12-04/juniper-tiktok-live');
  assert.equal(bySlug[firstId].slug, '2025-10-04/moonfest26xjunipertomas');
  assert.equal(bySlug[secondId].slug, '2025-10-04/moonfest26xjunipertomas-2');
  assert.equal(bySlug[alreadyAddressedId].slug, '2026-01-01/already-addressed');
  assert.ok(bySlug[noTagId].address_locked_at, 'the published event is now locked');
  assert.equal(bySlug[firstId].address_locked_at, null, 'no published entry: not locked');
});

test('a dry run writes nothing and reports what would change', async () => {
  const dryDb = await freshDb();
  try {
    const id = await dryDb.transaction((tx) => insertEvent(tx, {
      slug: 'another-one-part-slug-2026-03-01', occurredOn: '2026-03-01',
    }), { actor: 'system' });
    await dryDb.transaction((tx) => tx.query("update events set name = 'Another One' where id = $1", [id]), { actor: 'system' });
    /** @type {string[]} */
    const lines = [];
    const result = await readdressEvents(dryDb, { dryRun: true, log: (line) => lines.push(line) });
    assert.equal(result.changed, 1);
    assert.deepEqual(lines, ['another-one-part-slug-2026-03-01 -> 2026-03-01/another-one']);
    const { rows } = await dryDb.query('select slug from events where id = $1', [id]);
    assert.equal(rows[0].slug, 'another-one-part-slug-2026-03-01', 'dry run wrote nothing');
  } finally {
    await dryDb.end();
  }
});

test('a second run against an already-readdressed database reports changed: 0', async () => {
  const result = await readdressEvents(db, { dryRun: false });
  assert.deepEqual(result, { changed: 0, locked: 0 });
});
