// @ts-check
/**
 * Moving entries from one event to another: only entries that are in the
 * source event now, never into the same event or a merged-away one, with
 * an `item_edits` row and the purges for each moved entry.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { eventAdminSetup, fieldsOf } from '../helpers/eventAdmin.js';
import { moveEntries } from '../../src/services/eventMoves.js';
import { mergeEvents } from '../../src/services/eventAdmin.js';
import { BadRequest, Conflict } from '../../src/domain/errors.js';

/** @type {Awaited<ReturnType<typeof eventAdminSetup>>} */
let s;
before(async () => { s = await eventAdminSetup(); });
after(async () => { await s.deps.db.end(); });

/** @param {any} err @returns {boolean} */
const merged = (err) => err instanceof Conflict && err.code === 'merged';

test('moveEntries moves the ticked entries, records one item_edits row each and purges both events', async () => {
  const from = await s.makeEvent('2033-01-01/from');
  const to = await s.makeEvent('2033-01-02/to');
  const [a, b, stays] = [await s.makeItem(from), await s.makeItem(from, { reviewState: 'published' }), await s.makeItem(from)];
  const result = await moveEntries(s.deps, { fromEventId: from, itemIds: [a, b], toEventId: to, actor: s.owner });
  assert.deepEqual(result, { moved: 2 });
  assert.deepEqual(await s.eventIdsOf([a, b, stays]), [to, to, from]);
  const { rows } = await s.deps.db.query('select distinct placement from items where id = any($1::bigint[])', [[a, b]]);
  assert.deepEqual(rows, [{ placement: 'event' }]);
  for (const id of [a, b]) {
    assert.deepEqual(await s.editsOf(id), [{ before: { eventId: from }, after: { eventId: to }, reverts: null, created_by: s.owner.id }]);
    assert.ok(s.deleted.includes(`item:${id}`));
  }
  for (const tag of ['event:2033-01-01/from', 'event:2033-01-02/to', 'home', 'search']) assert.ok(s.purged.includes(tag), tag);
});

test('moveEntries never changes an entry’s date', async () => {
  const from = await s.makeEvent('2033-02-01/from');
  const to = await s.makeEvent('2033-02-20/to');
  const item = await s.makeItem(from);
  await moveEntries(s.deps, { fromEventId: from, itemIds: [item], toEventId: to, actor: s.owner });
  const { rows } = await s.deps.db.query('select occurred_on from items where id = $1', [item]);
  assert.equal(rows[0].occurred_on, '2026-02-13');
});

test('moveEntries refuses entries that aren’t in the source event now, and the same event, with 400, moving nothing', async () => {
  const from = await s.makeEvent('2033-03-01/from');
  const to = await s.makeEvent('2033-03-01/to');
  const elsewhere = await s.makeEvent('2033-03-01/elsewhere');
  const mine = await s.makeItem(from);
  const theirs = await s.makeItem(elsewhere);
  const gone = await s.makeItem(from);
  await s.deps.db.transaction((tx) => tx.query("update items set deleted_at = now(), deleted_reason = 'hidden_by_owner' where id = $1", [gone]), { actor: 'system' });
  const call = (/** @type {number[]} */ itemIds, toEventId = to) => moveEntries(s.deps, { fromEventId: from, itemIds, toEventId, actor: s.owner });
  await assert.rejects(call([]), BadRequest);
  await assert.rejects(call([mine, mine]), BadRequest);
  await assert.rejects(call([mine, theirs]), BadRequest, 'in another event');
  await assert.rejects(call([mine, gone]), BadRequest, 'deleted');
  await assert.rejects(call([mine, 999999]), BadRequest, 'unknown');
  await assert.rejects(call([mine], from), BadRequest, 'into the same event');
  await assert.rejects(call([mine], 999999), BadRequest, 'into an unknown event');
  assert.deepEqual(await s.eventIdsOf([mine, theirs]), [from, elsewhere]);
  assert.equal((await s.editsOf(mine)).length, 0);
});

test('a stale tab moving entries another tab already moved gets 400', async () => {
  const from = await s.makeEvent('2033-04-01/from');
  const to = await s.makeEvent('2033-04-01/to');
  const item = await s.makeItem(from);
  await moveEntries(s.deps, { fromEventId: from, itemIds: [item], toEventId: to, actor: s.owner });
  await assert.rejects(moveEntries(s.deps, { fromEventId: from, itemIds: [item], toEventId: to, actor: s.owner }), BadRequest);
  assert.equal((await s.editsOf(item)).length, 1);
});

test('moving from or into a merged-away event is 409 merged', async () => {
  const keep = await s.makeEvent('2033-05-01/keep');
  const gone = await s.makeEvent('2033-05-01/gone');
  const live = await s.makeEvent('2033-05-01/live');
  const inLive = await s.makeItem(live);
  await mergeEvents(s.deps, { keepId: keep, mergeIds: [gone], fields: fieldsOf({ occurredOn: '2033-05-01', addressTag: 'keep' }), actor: s.owner });
  await assert.rejects(moveEntries(s.deps, { fromEventId: live, itemIds: [inLive], toEventId: gone, actor: s.owner }), merged);
  await assert.rejects(moveEntries(s.deps, { fromEventId: gone, itemIds: [inLive], toEventId: live, actor: s.owner }), merged);
  assert.deepEqual(await s.eventIdsOf([inLive]), [live]);
});

test('entries move out of a report-hidden event like any other', async () => {
  const hidden = await s.makeEvent('2033-06-01/hidden');
  const to = await s.makeEvent('2033-06-01/to');
  const item = await s.makeItem(hidden);
  await s.deps.db.transaction((tx) => tx.query('update events set deleted_at = now() where id = $1', [hidden]), { actor: 'system' });
  await moveEntries(s.deps, { fromEventId: hidden, itemIds: [item], toEventId: to, actor: s.owner });
  assert.deepEqual(await s.eventIdsOf([item]), [to]);
});
