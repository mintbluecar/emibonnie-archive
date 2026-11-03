// @ts-check
/**
 * Event editing Task 1: `events.merged_into`, `events.address_locked_at`
 * (set once by the `lock_event_address` trigger on `items`), and the
 * two-part dated slug (`yyyy-mm-dd/tag`) the slug check now also accepts.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { insertEvent, insertItem, insertUser } from '../helpers/seed.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };
const write = (/** @type {(tx: any) => Promise<any>} */ fn) => db.transaction(fn, system);
const pgError = (/** @type {string} */ code) => (/** @type {any} */ err) => err.code === code;

test('a two-part slug is accepted and a slash elsewhere is refused', async () => {
  await write((tx) => insertEvent(tx, { slug: '2025-12-04/juniper-tiktok-live' }));

  await assert.rejects(
    write((tx) => insertEvent(tx, { slug: 'juniper/live' })),
    pgError('23514'),
  );
  await assert.rejects(
    write((tx) => insertEvent(tx, { slug: '2025-12-04/Bad' })),
    pgError('23514'),
  );
});

test('publishing an entry locks its event address once', async () => {
  const { eventId, itemId } = await write(async (tx) => {
    const eventId = await insertEvent(tx, { slug: 'event-one' });
    const itemId = await insertItem(tx, { placement: 'event', eventId, reviewState: 'pending' });
    return { eventId, itemId };
  });

  const before = await db.query('select address_locked_at from events where id = $1', [eventId]);
  assert.equal(before.rows[0].address_locked_at, null);

  await write((tx) => tx.query("update items set review_state = 'published' where id = $1", [itemId]));
  const afterFirst = await db.query('select address_locked_at from events where id = $1', [eventId]);
  assert.ok(afterFirst.rows[0].address_locked_at, 'locks on first publish');

  await write((tx) => tx.query("update items set review_state = 'published' where id = $1", [itemId]));
  const afterSecond = await db.query('select address_locked_at from events where id = $1', [eventId]);
  assert.deepEqual(afterSecond.rows[0].address_locked_at, afterFirst.rows[0].address_locked_at);
});

test('a publish into an already-locked event leaves the event row untouched', async () => {
  const { eventId, laterId } = await write(async (tx) => {
    const eventId = await insertEvent(tx, { slug: 'event-locked' });
    await insertItem(tx, { placement: 'event', eventId, reviewState: 'published' });
    const laterId = await insertItem(tx, { placement: 'event', eventId, reviewState: 'pending' });
    return { eventId, laterId };
  });
  const translator = await write((tx) => insertUser(tx));
  const stamp = 'select address_locked_at, updated_at, updated_by from events where id = $1';
  const locked = (await db.query(stamp, [eventId])).rows[0];
  assert.ok(locked.address_locked_at, 'the first publish locked it');

  await db.transaction((tx) => tx.query("update items set review_state = 'published' where id = $1", [laterId]), { actor: translator });
  assert.deepEqual((await db.query(stamp, [eventId])).rows[0], locked, 'no updated_at/updated_by rewrite, no lock re-stamp');
});

test('a pending entry moved into an event does not lock it', async () => {
  const eventId = await write((tx) => insertEvent(tx, { slug: 'event-two' }));
  const itemId = await write((tx) => insertItem(tx, { placement: 'unsorted', eventId: null, reviewState: 'pending' }));

  await write((tx) => tx.query(
    "update items set placement = 'event', event_id = $1 where id = $2",
    [eventId, itemId],
  ));

  const { rows } = await db.query('select address_locked_at from events where id = $1', [eventId]);
  assert.equal(rows[0].address_locked_at, null);
});

test('merged_into must name an event', async () => {
  const eventId = await write((tx) => insertEvent(tx, { slug: 'event-three' }));

  await assert.rejects(
    write((tx) => tx.query('update events set merged_into = $1 where id = $2', [999999, eventId])),
    pgError('23503'),
  );
});
