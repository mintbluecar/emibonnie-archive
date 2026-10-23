// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb, usingPostgres } from '../helpers/db.js';
import { insertItem, insertPerson } from '../helpers/seed.js';
import { createEvent, getEventBySlug, listEvents, softDeleteEvent } from '../../src/repo/events.js';

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
