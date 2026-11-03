// @ts-check
/**
 * The owner's event admin service: editing an event, merging events and
 * creating an event from another's entries. Validation, the merged-event
 * conflict, addresses (locked or not) and the one-transaction guarantee.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { eventAdminSetup, fieldsOf } from '../helpers/eventAdmin.js';
import { createEventWithEntries, editEvent, mergeEvents } from '../../src/services/eventAdmin.js';
import { BadRequest, Conflict, NotFound } from '../../src/domain/errors.js';

/** @type {Awaited<ReturnType<typeof eventAdminSetup>>} */
let s;
before(async () => { s = await eventAdminSetup(); });
after(async () => { await s.deps.db.end(); });

/** @param {any} err @returns {boolean} */
const merged = (err) => err instanceof Conflict && err.code === 'merged';

/** @param {string} sql @param {unknown[]} [params] @returns {Promise<number>} */
async function countOf(sql, params = []) {
  return (await s.deps.db.query(sql, params)).rows[0].n;
}

test('editEvent on an unlocked event saves every field and readdresses it to <new date>/<tag>', async () => {
  const id = await s.makeEvent('2032-01-01/old', { name: 'Old', keywords: ['gone'], hashtags: ['#Gone'] });
  const fields = fieldsOf({
    name: '  New name  ', occurredOn: '2032-01-05', keywords: ['k1'], hashtags: ['#H1', '#H2'],
    livePeopleIds: [1, 2], livePlatformCode: 'tiktok', addressTag: '#H2',
  });
  const { slug } = await editEvent(s.deps, { eventId: id, fields, actor: s.owner });
  assert.equal(slug, '2032-01-05/h2');
  const row = await s.eventRow(id);
  assert.equal(row.name, 'New name');
  assert.equal(row.occurred_on, '2032-01-05');
  assert.equal(row.slug, '2032-01-05/h2');
  assert.equal(row.live_platform, 'tiktok');
  const { rows: tags } = await s.deps.db.query(
    'select t.kind, t.display from event_tags et join tags t on t.id = et.tag_id where et.event_id = $1 order by t.kind, t.display', [id],
  );
  assert.deepEqual(tags.map((t) => `${t.kind}:${t.display}`), ['hashtag:#H1', 'hashtag:#H2', 'keyword:k1']);
  const { rows: live } = await s.deps.db.query("select person_id from event_people where event_id = $1 and role = 'live' order by 1", [id]);
  assert.deepEqual(live.map((r) => r.person_id), [1, 2]);
  assert.ok(s.purged.includes('event:2032-01-01/old') && s.purged.includes('event:2032-01-05/h2'));
  assert.ok(s.purged.includes('home') && s.purged.includes('search'));
});

test('a locked event keeps its slug whatever the date or address tag; its other fields still save', async () => {
  const id = await s.makeEvent('2032-02-01/locked');
  await s.makeItem(id, { reviewState: 'published' });
  assert.ok((await s.eventRow(id)).address_locked_at, 'publishing locked it');
  const { slug } = await editEvent(s.deps, {
    eventId: id, fields: fieldsOf({ name: 'Renamed', occurredOn: '2032-02-09', addressTag: 'other' }), actor: s.owner,
  });
  assert.equal(slug, '2032-02-01/locked');
  const row = await s.eventRow(id);
  assert.equal(row.slug, '2032-02-01/locked');
  assert.equal(row.name, 'Renamed');
  assert.equal(row.occurred_on, '2032-02-09');
});

test('readdressing excludes the event’s own slug, and another event’s address gets -2', async () => {
  const id = await s.makeEvent('2032-03-01/same');
  const again = await editEvent(s.deps, { eventId: id, fields: fieldsOf({ occurredOn: '2032-03-01', addressTag: 'same' }), actor: s.owner });
  assert.equal(again.slug, '2032-03-01/same', 'not a clash with itself');
  const other = await s.makeEvent('2032-03-02/other');
  const clash = await editEvent(s.deps, { eventId: other, fields: fieldsOf({ occurredOn: '2032-03-01', addressTag: 'same' }), actor: s.owner });
  assert.equal(clash.slug, '2032-03-01/same-2');
});

test('a blank address tag falls back to the first hashtag, else the name', async () => {
  const id = await s.makeEvent('2032-04-01/x');
  const byHashtag = await editEvent(s.deps, {
    eventId: id, fields: fieldsOf({ occurredOn: '2032-04-01', hashtags: ['#First', '#Second'], addressTag: '' }), actor: s.owner,
  });
  assert.equal(byHashtag.slug, '2032-04-01/first');
  const byName = await editEvent(s.deps, {
    eventId: id, fields: fieldsOf({ name: 'Juniper TikTok Live', occurredOn: '2032-04-01', addressTag: ' ' }), actor: s.owner,
  });
  assert.equal(byName.slug, '2032-04-01/juniper-tiktok-live');
});

test('editing an event never changes its entries’ dates', async () => {
  const id = await s.makeEvent('2032-05-01/dates');
  const itemId = await s.makeItem(id);
  await editEvent(s.deps, { eventId: id, fields: fieldsOf({ occurredOn: '2032-05-20' }), actor: s.owner });
  const { rows } = await s.deps.db.query('select occurred_on from items where id = $1', [itemId]);
  assert.equal(rows[0].occurred_on, '2026-02-13');
});

test('editEvent refuses bad fields with 400 and writes nothing', async () => {
  const id = await s.makeEvent('2032-06-01/valid', { name: 'Valid' });
  for (const bad of [
    { name: '   ' }, { name: 'x'.repeat(121) }, { occurredOn: '2032-6-01' }, { occurredOn: '2032-02-30' },
    { livePlatformCode: 'myspace' }, { keywords: /** @type {any} */ ('k') }, { livePeopleIds: /** @type {any} */ (['1']) },
  ]) {
    await assert.rejects(editEvent(s.deps, { eventId: id, fields: fieldsOf(bad), actor: s.owner }), BadRequest, JSON.stringify(bad));
  }
  const row = await s.eventRow(id);
  assert.equal(row.name, 'Valid');
  assert.equal(row.slug, '2032-06-01/valid');
});

test('editEvent: 120 characters is allowed; an unknown event is 404; a merged one is 409 merged', async () => {
  const id = await s.makeEvent('2032-07-01/long');
  await editEvent(s.deps, { eventId: id, fields: fieldsOf({ name: 'x'.repeat(120), occurredOn: '2032-07-01' }), actor: s.owner });
  await assert.rejects(editEvent(s.deps, { eventId: 999999, fields: fieldsOf(), actor: s.owner }), NotFound);
  const gone = await s.makeEvent('2032-07-02/gone', { name: 'Gone' });
  await mergeEvents(s.deps, { keepId: id, mergeIds: [gone], fields: fieldsOf({ occurredOn: '2032-07-01' }), actor: s.owner });
  await assert.rejects(editEvent(s.deps, { eventId: gone, fields: fieldsOf({ name: 'Stale tab' }), actor: s.owner }), merged);
  assert.equal((await s.eventRow(gone)).name, 'Gone');
});

test('merge, Moon Gala shape: keep #1 holds all 4 entries, the other two point at it, 2 item_edits rows', async () => {
  const keep = await s.makeEvent('2032-08-01/keep', { keywords: ['keep'] });
  const second = await s.makeEvent('2032-08-01/second', { hashtags: ['#Second'], livePeopleIds: [3] });
  const third = await s.makeEvent('2032-08-01/third');
  const kept = [await s.makeItem(keep), await s.makeItem(keep)];
  const moved = [await s.makeItem(second), await s.makeItem(third, { reviewState: 'published' })];
  const deletedItem = await s.makeItem(third);
  await s.deps.db.transaction((tx) => tx.query("update items set deleted_at = now(), deleted_reason = 'hidden_by_owner' where id = $1", [deletedItem]), { actor: 'system' });
  const fields = fieldsOf({ name: 'Moon Gala', occurredOn: '2032-08-01', keywords: ['keep'], hashtags: ['#Second', '#MOON'], addressTag: '#MOON' });

  const result = await mergeEvents(s.deps, { keepId: keep, mergeIds: [second, third], fields, actor: s.owner });

  assert.deepEqual(result, { slug: '2032-08-01/moon', moved: 2 });
  assert.deepEqual(await s.eventIdsOf([...kept, ...moved]), [keep, keep, keep, keep]);
  assert.deepEqual(await s.eventIdsOf([deletedItem]), [keep], 'a deleted entry is rewritten too (R10)');
  assert.deepEqual(await s.editsOf(deletedItem), [], 'but gets no item_edits row');
  for (const id of [second, third]) {
    const row = await s.eventRow(id);
    assert.equal(Number(row.merged_into), keep);
    assert.ok(row.deleted_at);
  }
  assert.equal((await s.eventRow(keep)).name, 'Moon Gala');
  assert.equal(await countOf("select count(*)::int as n from event_people where event_id = $1 and person_id = 3 and role = 'live'", [keep]), 0,
    'the form\u2019s live people (none) win over the merged event\u2019s (R9)');
  assert.deepEqual(await s.editsOf(moved[0]), [{ before: { eventId: second }, after: { eventId: keep }, reverts: null, created_by: s.owner.id }]);
  assert.deepEqual(await s.editsOf(moved[1]), [{ before: { eventId: third }, after: { eventId: keep }, reverts: null, created_by: s.owner.id }]);
  assert.equal(await countOf('select count(*)::int as n from item_edits where item_id = any($1::bigint[])', [kept]), 0);
  for (const tag of ['event:2032-08-01/second', 'event:2032-08-01/third', 'event:2032-08-01/keep', 'event:2032-08-01/moon']) {
    assert.ok(s.purged.includes(tag), tag);
  }
  for (const id of moved) assert.ok(s.deleted.includes(`item:${id}`), 'the moved entry’s own page is deleted');
});

test('merge never changes the moved entries\u2019 dates', async () => {
  const keep = await s.makeEvent('2032-09-01/dates-keep');
  const other = await s.makeEvent('2032-09-03/dates-other');
  const moved = [await s.makeItem(other), await s.makeItem(other, { reviewState: 'published' })];
  await s.deps.db.transaction((tx) => tx.query(
    "update items set occurred_on = case id when $1 then '2032-09-03'::date else '2032-09-04'::date end where id = any($2::bigint[])",
    [moved[0], moved],
  ), { actor: 'system' });
  const datesOf = async () => (await s.deps.db.query('select occurred_on from items where id = any($1::bigint[]) order by id', [moved])).rows.map((r) => r.occurred_on);
  const before = await datesOf();

  await mergeEvents(s.deps, { keepId: keep, mergeIds: [other], fields: fieldsOf({ occurredOn: '2032-09-01', addressTag: 'dates-keep' }), actor: s.owner });

  assert.deepEqual(await s.eventIdsOf(moved), [keep, keep]);
  assert.deepEqual(await datesOf(), before);
  assert.deepEqual(before, ['2032-09-03', '2032-09-04']);
});

test('merge: the form\u2019s live people are final, and a merged event\u2019s performer row is still copied (R9)', async () => {
  const keep = await s.makeEvent('2032-08-10/keep', { livePeopleIds: [1] });
  const gone = await s.makeEvent('2032-08-10/gone', { livePeopleIds: [2] });
  await s.inTx((tx) => tx.query("insert into event_people (event_id, person_id, role) values ($1, 4, 'performer')", [gone]));
  await mergeEvents(s.deps, { keepId: keep, mergeIds: [gone], fields: fieldsOf({ occurredOn: '2032-08-10', livePeopleIds: [1], addressTag: 'keep' }), actor: s.owner });
  const { rows } = await s.deps.db.query('select person_id, role from event_people where event_id = $1 order by role, person_id', [keep]);
  assert.deepEqual(rows.map((r) => `${r.role}:${r.person_id}`), ['live:1', 'performer:4']);
});

test('merge: a soft-deleted entry of a merged event moves to the kept event with no item_edits row (R10)', async () => {
  const keep = await s.makeEvent('2032-08-11/keep');
  const gone = await s.makeEvent('2032-08-11/gone');
  const deletedItem = await s.makeItem(gone);
  await s.inTx((tx) => tx.query("update items set deleted_at = now(), deleted_reason = 'hidden_by_owner' where id = $1", [deletedItem]));
  const result = await mergeEvents(s.deps, { keepId: keep, mergeIds: [gone], fields: fieldsOf({ occurredOn: '2032-08-11', addressTag: 'keep' }), actor: s.owner });
  assert.equal(result.moved, 0, 'moved counts the live entries only');
  const { rows } = await s.deps.db.query('select event_id, placement, deleted_at from items where id = $1', [deletedItem]);
  assert.equal(Number(rows[0].event_id), keep);
  assert.equal(rows[0].placement, 'event');
  assert.ok(rows[0].deleted_at, 'still deleted');
  assert.deepEqual(await s.editsOf(deletedItem), []);
  assert.ok(!s.deleted.includes(`item:${deletedItem}`), 'no purge for a deleted entry');
});

test('merge refuses nonsense input with 400 and merged events with 409, writing nothing', async () => {
  const keep = await s.makeEvent('2032-09-01/keep', { name: 'Keep' });
  const other = await s.makeEvent('2032-09-01/other', { name: 'Other' });
  const item = await s.makeItem(other);
  const call = (/** @type {number} */ keepId, /** @type {number[]} */ mergeIds) =>
    mergeEvents(s.deps, { keepId, mergeIds, fields: fieldsOf({ name: 'Changed', occurredOn: '2032-09-01' }), actor: s.owner });
  await assert.rejects(call(keep, []), BadRequest);
  await assert.rejects(call(keep, [keep]), BadRequest);
  await assert.rejects(call(keep, [other, keep]), BadRequest);
  await assert.rejects(call(keep, [other, other]), BadRequest);
  await assert.rejects(call(keep, [other, 999999]), BadRequest);
  await assert.rejects(mergeEvents(s.deps, { keepId: keep, mergeIds: [other], fields: fieldsOf({ name: '' }), actor: s.owner }), BadRequest);

  const gone = await s.makeEvent('2032-09-01/gone');
  const elsewhere = await s.makeEvent('2032-09-02/elsewhere');
  await mergeEvents(s.deps, { keepId: elsewhere, mergeIds: [gone], fields: fieldsOf({ occurredOn: '2032-09-02' }), actor: s.owner });
  await assert.rejects(call(keep, [other, gone]), merged, 'a merged-away event in mergeIds');
  await assert.rejects(call(gone, [other]), merged, 'a merged-away keep');

  assert.equal((await s.eventRow(keep)).name, 'Keep');
  assert.equal((await s.eventRow(other)).merged_into, null);
  assert.deepEqual(await s.eventIdsOf([item]), [other]);
});

test('a report-hidden event can be merged in, and its entries move', async () => {
  const keep = await s.makeEvent('2032-10-01/keep');
  const hidden = await s.makeEvent('2032-10-01/hidden');
  const item = await s.makeItem(hidden);
  await s.deps.db.transaction((tx) => tx.query('update events set deleted_at = now() where id = $1', [hidden]), { actor: 'system' });
  await mergeEvents(s.deps, { keepId: keep, mergeIds: [hidden], fields: fieldsOf({ occurredOn: '2032-10-01', addressTag: 'keep' }), actor: s.owner });
  assert.deepEqual(await s.eventIdsOf([item]), [keep]);
  assert.equal(Number((await s.eventRow(hidden)).merged_into), keep);
});

test('createEventWithEntries makes the event and moves the entries in, one item_edits row each', async () => {
  const from = await s.makeEvent('2032-11-01/from');
  const [a, b, stays] = [await s.makeItem(from), await s.makeItem(from), await s.makeItem(from)];
  const fields = fieldsOf({ name: 'Split out', occurredOn: '2032-11-02', hashtags: ['#Split'], livePlatformCode: 'instagram', addressTag: '' });
  const result = await createEventWithEntries(s.deps, { fromEventId: from, itemIds: [a, b], fields, actor: s.owner });
  assert.equal(result.slug, '2032-11-02/split');
  assert.equal(result.moved, 2);
  const row = await s.eventRow(result.eventId);
  assert.equal(row.name, 'Split out');
  assert.equal(row.live_platform, 'instagram');
  assert.deepEqual(await s.eventIdsOf([a, b, stays]), [result.eventId, result.eventId, from]);
  assert.deepEqual(await s.editsOf(a), [{ before: { eventId: from }, after: { eventId: result.eventId }, reverts: null, created_by: s.owner.id }]);
  assert.ok(s.purged.includes('event:2032-11-01/from') && s.purged.includes('event:2032-11-02/split'));
});

test('createEventWithEntries creates nothing on a validation error or a stale entry list', async () => {
  const from = await s.makeEvent('2032-12-01/from');
  const other = await s.makeEvent('2032-12-01/other');
  const mine = await s.makeItem(from);
  const theirs = await s.makeItem(other);
  const events = await countOf('select count(*)::int as n from events');
  const call = (/** @type {number[]} */ itemIds, /** @type {any} */ fields = fieldsOf({ occurredOn: '2032-12-02' })) =>
    createEventWithEntries(s.deps, { fromEventId: from, itemIds, fields, actor: s.owner });
  await assert.rejects(call([mine], fieldsOf({ name: '' })), BadRequest);
  await assert.rejects(call([]), BadRequest);
  await assert.rejects(call([mine, mine]), BadRequest);
  await assert.rejects(call([mine, theirs]), BadRequest, 'an entry of another event');
  assert.equal(await countOf('select count(*)::int as n from events'), events);
  assert.deepEqual(await s.eventIdsOf([mine, theirs]), [from, other]);

  await mergeEvents(s.deps, { keepId: other, mergeIds: [from], fields: fieldsOf({ occurredOn: '2032-12-01', addressTag: 'other' }), actor: s.owner });
  await assert.rejects(call([mine]), merged, 'a merged-away source event');
  assert.equal(await countOf('select count(*)::int as n from events'), events);
});
