// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb, usingPostgres } from '../helpers/db.js';
import { insertItem, insertPerson } from '../helpers/seed.js';
import { createEvent, followMerged, getEventBySlug, listEvents, resolveMergedSlug, softDeleteEvent } from '../../src/repo/events.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };

/** @param {Partial<import('../../src/domain/events.js').EventProposal>} fields */
function proposal(fields) {
  return {
    name: 'An event',
    slug: 'an-event-2026-02-13',
    addressTag: 'an-event',
    occurredOn: '2026-02-13',
    keywords: [],
    hashtags: [],
    livePeopleIds: [],
    livePlatformCode: null,
    ...fields,
  };
}

test('createEvent writes the event, its tags, and returns the Event shape', async () => {
  const event = await db.transaction(
    (tx) => createEvent(tx, proposal({ slug: 'tagged-event', keywords: ['A KEYWORD'], hashtags: ['#AHashtag'] })),
    system,
  );
  assert.equal(event.slug, 'tagged-event');
  assert.deepEqual(event.keywords, ['A KEYWORD']);
  assert.deepEqual(event.hashtags, ['#AHashtag']);

  const found = await getEventBySlug(db, 'tagged-event');
  assert.equal(found?.id, event.id);
});

test(
  `createEvent: two concurrent calls with the same slug yield 1 row (${usingPostgres ? 'run concurrently on Postgres' : 'PGlite has one connection, so this runs sequentially -- the second call returns the existing event'})`,
  async () => {
    const slug = 'joint-event-2026-02-13';
    const [a, b] = await Promise.all([
      db.transaction((tx) => createEvent(tx, proposal({ slug })), system),
      db.transaction((tx) => createEvent(tx, proposal({ slug })), system),
    ]);
    assert.equal(a.id, b.id);

    const { rows } = await db.query('select count(*)::int as n from events where slug = $1', [slug]);
    assert.equal(rows[0].n, 1);
  },
);

test('a joint-live event has 2 event_people rows', async () => {
  const { solId, lunaId } = await db.transaction(async (tx) => {
    const solId = await insertPerson(tx, { name: 'Sol' });
    const lunaId = await insertPerson(tx, { name: 'Luna' });
    return { solId, lunaId };
  }, system);

  const event = await db.transaction(
    (tx) => createEvent(tx, proposal({ slug: 'joint-live-2026-02-13', livePeopleIds: [solId, lunaId], livePlatformCode: 'instagram' })),
    system,
  );
  assert.deepEqual(new Set(event.livePeopleIds), new Set([solId, lunaId]));
  assert.equal(event.livePlatformCode, 'instagram');

  const { rows } = await db.query("select count(*)::int as n from event_people where event_id = $1 and role = 'live'", [event.id]);
  assert.equal(rows[0].n, 2);
});

test('softDeleteEvent moves its items to unsorted, in the same transaction', async () => {
  const event = await db.transaction((tx) => createEvent(tx, proposal({ slug: 'to-delete-2026-02-13' })), system);
  const itemId = await db.transaction((tx) => insertItem(tx, { placement: 'event', eventId: event.id }), system);

  await db.transaction((tx) => softDeleteEvent(tx, event.id), system);

  const item = await db.query('select placement, event_id from items where id = $1', [itemId]);
  assert.equal(item.rows[0].placement, 'unsorted');
  assert.equal(item.rows[0].event_id, null);

  const deletedEvent = await db.query('select deleted_at, deleted_by from events where id = $1', [event.id]);
  assert.ok(deletedEvent.rows[0].deleted_at instanceof Date);
  assert.equal(deletedEvent.rows[0].deleted_by, 'system');
});

test('listEvents orders by occurred_on desc and joins keywords, hashtags, livePeopleIds, livePlatformCode', async () => {
  await db.transaction((tx) => createEvent(tx, proposal({ slug: 'list-check-2026-05-01', occurredOn: '2026-05-01' })), system);
  const events = await listEvents(db);
  const found = events.find((e) => e.slug === 'list-check-2026-05-01');
  assert.ok(found);
  assert.deepEqual(found.keywords, []);
  assert.deepEqual(found.hashtags, []);
  assert.deepEqual(found.livePeopleIds, []);
  assert.equal(found.livePlatformCode, null);
});

/**
 * A chain of events, each merged into the next and soft-deleted, ending
 * at the last one (left as `lastDeleted` says). Returns their ids in order.
 * @param {string} prefix @param {number} length @param {{ lastDeleted?: boolean }} [options]
 * @returns {Promise<number[]>}
 */
async function mergedChain(prefix, length, { lastDeleted = false } = {}) {
  return db.transaction(async (tx) => {
    /** @type {number[]} */
    const ids = [];
    for (let i = 0; i < length; i += 1) {
      const { rows } = await tx.query("insert into events (slug, name, occurred_on) values ($1, 'Chain', '2025-10-04') returning id", [`2025-10-04/${prefix}-${i}`]);
      ids.push(rows[0].id);
    }
    for (let i = 0; i < length - 1; i += 1) {
      await tx.query('update events set merged_into = $2, deleted_at = now() where id = $1', [ids[i], ids[i + 1]]);
    }
    if (lastDeleted) await tx.query('update events set deleted_at = now() where id = $1', [ids[length - 1]]);
    return ids;
  }, system);
}

test('followMerged: the final non-deleted event along merged_into, itself when not merged', async () => {
  const ids = await mergedChain('follow', 3);
  assert.equal(await followMerged(db, ids[0]), ids[2]);
  assert.equal(await followMerged(db, ids[1]), ids[2]);
  assert.equal(await followMerged(db, ids[2]), ids[2], 'a live, unmerged event is its own answer');
  assert.equal(await followMerged(db, 999999), null, 'no such event');
});

test('followMerged: null when the chain ends at a deleted, unmerged event', async () => {
  const ids = await mergedChain('dead-end', 2, { lastDeleted: true });
  assert.equal(await followMerged(db, ids[0]), null);
});

test('followMerged: bounded at 20 hops', async () => {
  const within = await mergedChain('within', 21);
  assert.equal(await followMerged(db, within[0]), within[20], '20 hops');
  const beyond = await mergedChain('beyond', 22);
  assert.equal(await followMerged(db, beyond[0]), null, '21 hops is past the bound');
});

test('resolveMergedSlug: a merged-away slug answers the kept slug; any other slug answers null', async () => {
  await mergedChain('resolve', 3);
  assert.equal(await resolveMergedSlug(db, '2025-10-04/resolve-0'), '2025-10-04/resolve-2');
  assert.equal(await resolveMergedSlug(db, '2025-10-04/resolve-2'), null, 'not merged');
  assert.equal(await resolveMergedSlug(db, '2025-10-04/no-such'), null);
  await mergedChain('resolve-dead', 2, { lastDeleted: true });
  assert.equal(await resolveMergedSlug(db, '2025-10-04/resolve-dead-0'), null);
});

test('createEvent with a merged-away event\'s slug returns the kept event and inserts nothing', async () => {
  const ids = await mergedChain('recreate', 3);
  const { rows: before } = await db.query('select count(*)::int as n from events');

  const event = await db.transaction((tx) => createEvent(tx, proposal({ slug: '2025-10-04/recreate-0', name: 'Recreated' })), system);
  assert.equal(event.id, ids[2]);
  assert.equal(event.slug, '2025-10-04/recreate-2');

  const { rows: afterRows } = await db.query('select count(*)::int as n from events');
  assert.equal(afterRows[0].n, before[0].n);
});
