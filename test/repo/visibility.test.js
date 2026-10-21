// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { insertEvent, insertItem, insertAccount, insertUser } from '../helpers/seed.js';
import { visibleEvent, visibleItem } from '../../src/repo/visibility.js';
import { countsByEvent, listVisibleItemIds, neighbours } from '../../src/repo/items.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };

test('visibleItem/visibleEvent reject an alias that is not ^[a-z_]+$, and accept their own default', () => {
  assert.throws(() => visibleItem('i; drop table items'), /invalid alias/);
  assert.throws(() => visibleEvent('1e'), /invalid alias/);
  assert.throws(() => visibleItem('I'), /invalid alias/);
  assert.doesNotThrow(() => visibleItem());
  assert.doesNotThrow(() => visibleEvent());
  assert.doesNotThrow(() => visibleItem('event_item'));
});

test('visibleItem/visibleEvent never interpolate anything other than the alias itself', () => {
  for (const sql of [visibleItem('custom'), visibleEvent('custom')]) {
    assert.equal(typeof sql, 'string');
    assert.ok(!/select 1 from accounts a where a.id = \$/.test(sql), 'no placeholders -- no values are interpolated');
  }
});

/** @param {number} eventId */
async function isEventVisible(eventId) {
  const { rows } = await db.query(`select (${visibleEvent('e')}) as visible from events e where e.id = $1`, [eventId]);
  return rows[0].visible;
}

/**
 * Each case builds one event with a visible sibling item and one item
 * hidden by the named reason, then checks the hidden item never shows up.
 * @type {{ name: string, hide(eventId: number): Promise<number> }[]}
 */
const CASES = [
  {
    name: 'removed (soft-deleted)',
    hide: async (eventId) => {
      const id = await db.transaction((tx) => insertItem(tx, { placement: 'event', eventId }), system);
      await db.transaction((tx) => tx.query("update items set deleted_at = now(), deleted_reason = 'hidden_by_owner' where id = $1", [id]), system);
      return id;
    },
  },
  {
    name: 'pending review',
    hide: (eventId) => db.transaction((tx) => insertItem(tx, { placement: 'event', eventId, reviewState: 'pending' }), system),
  },
  {
    name: 'opted-out credited account',
    hide: async (eventId) => {
      const accountId = await db.transaction((tx) => insertAccount(tx, { optedOut: true }), system);
      return db.transaction((tx) => insertItem(tx, { placement: 'event', eventId, creditedAccountId: accountId }), system);
    },
  },
  {
    name: 'blocked submitter',
    hide: async (eventId) => {
      const blockedUserId = await db.transaction((tx) => insertUser(tx, { blockedAt: true }), system);
      return db.transaction((tx) => insertItem(tx, { placement: 'event', eventId }), { actor: blockedUserId });
    },
  },
];

for (const { name, hide } of CASES) {
  test(`${name}: hidden item is absent from listVisibleItemIds, counts, and neighbours; its event stays visible via the sibling`, async () => {
    const eventId = await db.transaction((tx) => insertEvent(tx, { slug: `vis-${name.replace(/[^a-z]/g, '-')}` }), system);
    const sibling = await db.transaction((tx) => insertItem(tx, { placement: 'event', eventId, sortKey: 1 }), system);
    await hide(eventId);

    const visibleIds = await listVisibleItemIds(db, { eventId });
    assert.deepEqual(visibleIds.map((r) => r.id), [sibling]);

    const counts = await countsByEvent(db);
    const thisEvent = counts.find((c) => c.eventId === eventId);
    assert.equal(thisEvent?.count, 1);

    const siblingNeighbours = await neighbours(db, sibling);
    assert.deepEqual(siblingNeighbours, { prev: null, next: null });

    assert.equal(await isEventVisible(eventId), true);
  });

  test(`${name}: an event whose only item is hidden is itself absent from visibleEvent`, async () => {
    const eventId = await db.transaction((tx) => insertEvent(tx, { slug: `vis-only-${name.replace(/[^a-z]/g, '-')}` }), system);
    await hide(eventId);
    assert.equal(await isEventVisible(eventId), false);
  });
}
