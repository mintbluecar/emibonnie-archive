// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { insertEvent, insertItem, insertAccount, insertUser, insertPerson } from '../helpers/seed.js';
import { visibleEvent, visibleItem } from '../../src/repo/visibility.js';
import { countsByEvent, countsForAccount, countsForPerson, listVisibleItemIds, neighbours } from '../../src/repo/items.js';
import { setItemPeople } from '../../src/repo/itemPeople.js';

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

test("visibleItem/visibleEvent reject the 'vis_' prefix: it's reserved for this file's own inner aliases", () => {
  assert.throws(() => visibleItem('vis_item'), /invalid alias/);
  assert.throws(() => visibleItem('vis_acct'), /invalid alias/);
  assert.throws(() => visibleEvent('vis_user'), /invalid alias/);
});

test('visibleItem/visibleEvent never interpolate anything other than the alias itself', () => {
  for (const sql of [visibleItem('custom'), visibleEvent('custom')]) {
    assert.equal(typeof sql, 'string');
    assert.ok(!/select 1 from accounts a where a.id = \$/.test(sql), 'no placeholders -- no values are interpolated');
  }
});

/** @param {number} eventId @param {string} [alias] */
async function isEventVisible(eventId, alias) {
  const { rows } = await db.query(`select (${visibleEvent(alias)}) as visible from events ${alias ?? 'e'} where ${alias ?? 'e'}.id = $1`, [eventId]);
  return rows[0].visible;
}

/**
 * The alias-shadowing bug this guards against: `visibleItem('u')` used
 * to turn `not exists (select 1 from users u where u.id = ...)` into a
 * self-referential, always-false check against the outer `u` itself,
 * which would make a blocked item look visible. Same story for `a` and
 * the accounts check, and for `visibleEvent('i')` against `items i`.
 */
test('visibleItem keeps hiding a blocked item and an opted-out item under caller aliases u and a', async () => {
  const blockedUserId = await db.transaction((tx) => insertUser(tx, { blockedAt: true }), system);
  const blockedItemId = await db.transaction((tx) => insertItem(tx), { actor: blockedUserId });
  const optedOutAccountId = await db.transaction((tx) => insertAccount(tx, { optedOut: true }), system);
  const optedOutItemId = await db.transaction((tx) => insertItem(tx, { creditedAccountId: optedOutAccountId }), system);

  for (const alias of ['u', 'a']) {
    const { rows } = await db.query(
      `select id from items ${alias} where ${alias}.id in ($1, $2) and (${visibleItem(alias)})`,
      [blockedItemId, optedOutItemId],
    );
    assert.deepEqual(rows, [], `alias '${alias}' must still hide both items`);
  }
});

test("visibleEvent('i') still finds its visible item, instead of colliding with the inner items alias", async () => {
  const eventId = await db.transaction((tx) => insertEvent(tx, { slug: 'vis-alias-i' }), system);
  await db.transaction((tx) => insertItem(tx, { placement: 'event', eventId }), system);
  assert.equal(await isEventVisible(eventId, 'i'), true);
});

/**
 * Each case builds one event with a visible sibling item and one item
 * hidden by the named reason, carrying its own credited account and a
 * person via `item_people`, then checks the hidden item never shows up
 * -- in listings, counts (by event, by account, by person), or as
 * anyone else's neighbour -- while the event itself stays visible via
 * its visible sibling.
 * @type {{ name: string, hide(eventId: number): Promise<{ itemId: number, accountId: number, personId: number }> }[]}
 */
const CASES = [
  {
    name: 'removed (soft-deleted)',
    hide: async (eventId) => {
      const accountId = await db.transaction((tx) => insertAccount(tx), system);
      const personId = await db.transaction((tx) => insertPerson(tx, { name: 'Removed target' }), system);
      const itemId = await db.transaction((tx) => insertItem(tx, { placement: 'event', eventId, creditedAccountId: accountId }), system);
      await db.transaction((tx) => setItemPeople(tx, itemId, [{ personId, role: 'present' }]), system);
      await db.transaction((tx) => tx.query("update items set deleted_at = now(), deleted_reason = 'hidden_by_owner' where id = $1", [itemId]), system);
      return { itemId, accountId, personId };
    },
  },
  {
    name: 'pending review',
    hide: async (eventId) => {
      const accountId = await db.transaction((tx) => insertAccount(tx), system);
      const personId = await db.transaction((tx) => insertPerson(tx, { name: 'Pending target' }), system);
      const itemId = await db.transaction(
        (tx) => insertItem(tx, { placement: 'event', eventId, reviewState: 'pending', creditedAccountId: accountId }),
        system,
      );
      await db.transaction((tx) => setItemPeople(tx, itemId, [{ personId, role: 'present' }]), system);
      return { itemId, accountId, personId };
    },
  },
  {
    name: 'opted-out credited account',
    hide: async (eventId) => {
      const accountId = await db.transaction((tx) => insertAccount(tx, { optedOut: true }), system);
      const personId = await db.transaction((tx) => insertPerson(tx, { name: 'Opted-out target' }), system);
      const itemId = await db.transaction((tx) => insertItem(tx, { placement: 'event', eventId, creditedAccountId: accountId }), system);
      await db.transaction((tx) => setItemPeople(tx, itemId, [{ personId, role: 'present' }]), system);
      return { itemId, accountId, personId };
    },
  },
  {
    name: 'blocked submitter',
    hide: async (eventId) => {
      const accountId = await db.transaction((tx) => insertAccount(tx), system);
      const personId = await db.transaction((tx) => insertPerson(tx, { name: 'Blocked target' }), system);
      const blockedUserId = await db.transaction((tx) => insertUser(tx, { blockedAt: true }), system);
      const itemId = await db.transaction(
        (tx) => insertItem(tx, { placement: 'event', eventId, creditedAccountId: accountId }),
        { actor: blockedUserId },
      );
      await db.transaction((tx) => setItemPeople(tx, itemId, [{ personId, role: 'present' }]), system);
      return { itemId, accountId, personId };
    },
  },
];

for (const { name, hide } of CASES) {
  test(`${name}: hidden item is absent from listVisibleItemIds, counts (by event, account, person) and neighbours; its event stays visible via the sibling`, async () => {
    const eventId = await db.transaction((tx) => insertEvent(tx, { slug: `vis-${name.replace(/[^a-z]/g, '-')}` }), system);
    const sibling = await db.transaction((tx) => insertItem(tx, { placement: 'event', eventId, sortKey: 1 }), system);
    const { accountId, personId } = await hide(eventId);

    const visibleIds = await listVisibleItemIds(db, { eventId });
    assert.deepEqual(visibleIds.map((r) => r.id), [sibling]);

    const counts = await countsByEvent(db);
    const thisEvent = counts.find((c) => c.eventId === eventId);
    assert.equal(thisEvent?.count, 1);

    assert.equal(await countsForAccount(db, accountId), 0, 'the hidden item\'s own account must count 0');
    assert.equal(await countsForPerson(db, personId), 0, 'the hidden item\'s own person must count 0');
    assert.deepEqual(await listVisibleItemIds(db, { accountId }), []);
    assert.deepEqual(await listVisibleItemIds(db, { personId }), []);

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
