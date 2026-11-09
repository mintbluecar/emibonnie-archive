// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { insertEvent, insertItem, insertPerson, insertSource } from '../helpers/seed.js';
import { createEvent, followMerged, hideEvent } from '../../src/repo/events.js';
import {
  getAdminEvent, listAdminEvents, listEventEntries, markMerged, moveItemsToEvent,
  replaceEventTags, replaceLivePeople, resolveEventId, takenSlugs, updateEventFields,
} from '../../src/repo/eventAdmin.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };
const ALL = { q: '', limit: 500, offset: 0 };

/** @param {(tx: any) => Promise<any>} fn */
function inTx(fn) {
  return db.transaction(fn, system);
}

/**
 * An event via `createEvent`, so its tags and live people are real rows.
 * @param {string} slug @param {Partial<import('../../src/domain/events.js').EventProposal>} [fields]
 */
function makeEvent(slug, fields = {}) {
  return inTx((tx) => createEvent(tx, {
    name: 'Event', slug, addressTag: 'event', occurredOn: slug.slice(0, 10),
    keywords: [], hashtags: [], livePeopleIds: [], livePlatformCode: null, ...fields,
  }));
}

/** @param {number} itemId @param {number} personId */
function linkPerson(itemId, personId) {
  return inTx((tx) => tx.query("insert into item_people (item_id, person_id, role) values ($1, $2, 'present')", [itemId, personId]));
}

/** A soft-deleted entry in `eventId`. @param {number} eventId */
function insertDeletedItem(eventId) {
  return inTx(async (tx) => {
    const itemId = await insertItem(tx, { placement: 'event', eventId, reviewState: 'pending' });
    await tx.query("update items set deleted_at = now(), deleted_reason = 'hidden_by_owner' where id = $1", [itemId]);
    return itemId;
  });
}

test('listAdminEvents: counts non-deleted entries of any review state and lists their people once each', async () => {
  const event = await makeEvent('2031-01-01/counted', { name: 'Counted' });
  const solId = await inTx((tx) => insertPerson(tx, { name: 'Sol' }));
  const lunaId = await inTx((tx) => insertPerson(tx, { name: 'Luna' }));
  const a = await inTx((tx) => insertItem(tx, { placement: 'event', eventId: event.id, reviewState: 'pending' }));
  const b = await inTx((tx) => insertItem(tx, { placement: 'event', eventId: event.id, reviewState: 'published' }));
  const gone = await insertDeletedItem(event.id);
  await linkPerson(a, solId);
  await linkPerson(b, solId);
  await linkPerson(b, lunaId);
  await linkPerson(gone, await inTx((tx) => insertPerson(tx, { name: 'Deleted-only' })));

  const { events } = await listAdminEvents(db, ALL);
  const row = events.find((e) => e.id === event.id);
  assert.deepEqual(row, {
    id: event.id, slug: '2031-01-01/counted', name: 'Counted', occurredOn: '2031-01-01',
    entryCount: 2, people: ['Luna', 'Sol'], hidden: false, addressLocked: true,
  });
});

test('listAdminEvents: a hidden event appears with hidden: true; a merged-away event never appears', async () => {
  const hidden = await makeEvent('2031-02-01/hidden');
  await inTx((tx) => hideEvent(tx, hidden.id));
  const keep = await makeEvent('2031-02-02/keep');
  const gone = await makeEvent('2031-02-03/gone');
  await inTx((tx) => markMerged(tx, { mergeIds: [gone.id], keepId: keep.id }));

  const { events } = await listAdminEvents(db, ALL);
  assert.equal(events.find((e) => e.id === hidden.id)?.hidden, true);
  assert.equal(events.find((e) => e.id === keep.id)?.hidden, false);
  assert.equal(events.some((e) => e.id === gone.id), false);
  assert.equal(events.find((e) => e.id === hidden.id)?.entryCount, 0);
});

test('listAdminEvents: q matches name, keyword or hashtag, case-insensitively; total counts every match', async () => {
  await makeEvent('2032-03-01/by-hashtag', { name: 'A show', hashtags: ['#MOONGALA'] });
  await makeEvent('2032-03-02/by-keyword', { name: 'Another', keywords: ['Moon Gala MOONGALA'] });
  await makeEvent('2032-03-03/by-name', { name: 'moongala night' });
  await makeEvent('2032-03-04/no-match', { name: 'Unrelated' });

  const all = await listAdminEvents(db, { q: 'moongala', limit: 10, offset: 0 });
  assert.deepEqual(all.events.map((e) => e.slug), ['2032-03-03/by-name', '2032-03-02/by-keyword', '2032-03-01/by-hashtag']);
  assert.equal(all.total, 3);

  const quote = await listAdminEvents(db, { q: "o'brien", limit: 10, offset: 0 });
  assert.equal(quote.total, 0, 'q is a parameter, never SQL');
});

test('listAdminEvents: newest occurred_on first, then id desc; limit and offset page it, total is unpaged', async () => {
  const older = await makeEvent('2040-01-01/page-a', { name: 'Paged' });
  const sameDayFirst = await makeEvent('2040-01-02/page-b', { name: 'Paged' });
  const sameDaySecond = await makeEvent('2040-01-02/page-c', { name: 'Paged' });

  const first = await listAdminEvents(db, { q: 'paged', limit: 2, offset: 0 });
  assert.deepEqual(first.events.map((e) => e.id), [sameDaySecond.id, sameDayFirst.id]);
  assert.equal(first.total, 3);
  const second = await listAdminEvents(db, { q: 'paged', limit: 2, offset: 2 });
  assert.deepEqual(second.events.map((e) => e.id), [older.id]);
  assert.equal(second.total, 3);
});

test('getAdminEvent: the list row plus tags, live details and mergedInto; null for an unknown id', async () => {
  const solId = await inTx((tx) => insertPerson(tx, { name: 'Sol' }));
  const keep = await makeEvent('2033-01-01/detail', {
    name: 'Detail', keywords: ['A KEYWORD'], hashtags: ['#Tag'], livePeopleIds: [solId], livePlatformCode: 'instagram',
  });
  const gone = await makeEvent('2033-01-02/detail-gone');
  await inTx((tx) => markMerged(tx, { mergeIds: [gone.id], keepId: keep.id }));

  assert.deepEqual(await getAdminEvent(db, keep.id), {
    id: keep.id, slug: '2033-01-01/detail', name: 'Detail', occurredOn: '2033-01-01', entryCount: 0, people: [],
    hidden: false, addressLocked: false, keywords: ['A KEYWORD'], hashtags: ['#Tag'], livePeopleIds: [solId],
    livePlatformCode: 'instagram', mergedInto: null,
  });
  const merged = await getAdminEvent(db, gone.id);
  assert.equal(merged?.mergedInto, keep.id);
  assert.equal(merged?.hidden, true);
  assert.equal(await getAdminEvent(db, 999999), null);
});

/**
 * An entry with a primary source.
 * @param {number} eventId @param {{ externalId: string, sortKey: number, reviewState?: string }} entry
 */
function insertEntry(eventId, { externalId, sortKey, reviewState = 'pending' }) {
  return inTx(async (tx) => {
    const itemId = await insertItem(tx, { placement: 'event', eventId, sortKey, reviewState });
    await insertSource(tx, { itemId, externalId });
    return itemId;
  });
}

test('listEventEntries: non-deleted entries in occurred_on, sort_key, id order, with their people', async () => {
  const event = await makeEvent('2034-01-01/entries');
  const later = await insertEntry(event.id, { externalId: 'e-later', sortKey: 2 });
  const first = await insertEntry(event.id, { externalId: 'e-first', sortKey: 1, reviewState: 'published' });
  const last = await insertEntry(event.id, { externalId: 'e-last', sortKey: 3 });
  const deleted = await insertDeletedItem(event.id);
  const lunaId = await inTx((tx) => insertPerson(tx, { name: 'Luna' }));
  await linkPerson(first, lunaId);

  const entries = await listEventEntries(db, event.id);
  assert.deepEqual(entries.map((e) => e.itemId), [first, later, last]);
  assert.equal(entries.some((e) => e.itemId === deleted), false);
  assert.deepEqual(entries[0], {
    itemId: first, kind: 'translation', sourceId: 'e-first', sourceUrl: 'https://example.com/status/e-first',
    occurredOn: '2026-02-13', reviewState: 'published', people: ['Luna'],
  });
  assert.deepEqual(entries[1].people, []);
});

test('updateEventFields, replaceEventTags and replaceLivePeople rewrite the event', async () => {
  const solId = await inTx((tx) => insertPerson(tx, { name: 'Sol' }));
  const lunaId = await inTx((tx) => insertPerson(tx, { name: 'Luna' }));
  const event = await makeEvent('2035-01-01/before', { keywords: ['OLD'], hashtags: ['#Old'], livePeopleIds: [solId] });

  await inTx(async (tx) => {
    await updateEventFields(tx, event.id, { name: 'After', occurredOn: '2035-02-02', slug: '2035-02-02/after', livePlatformCode: 'instagram' });
    await replaceEventTags(tx, event.id, { keywords: ['NEW', 'new'], hashtags: ['#New'] });
    await replaceLivePeople(tx, event.id, [lunaId, lunaId]);
  });

  const after = await getAdminEvent(db, event.id);
  assert.equal(after?.name, 'After');
  assert.equal(after?.occurredOn, '2035-02-02');
  assert.equal(after?.slug, '2035-02-02/after');
  assert.equal(after?.livePlatformCode, 'instagram');
  assert.deepEqual(after?.keywords, ['NEW'], 'one tag per norm');
  assert.deepEqual(after?.hashtags, ['#New']);
  assert.deepEqual(after?.livePeopleIds, [lunaId]);
});

test('replaceLivePeople leaves performer and guest rows alone', async () => {
  const solId = await inTx((tx) => insertPerson(tx, { name: 'Sol' }));
  const event = await makeEvent('2035-03-01/roles', { livePeopleIds: [solId] });
  await inTx((tx) => tx.query("insert into event_people (event_id, person_id, role) values ($1, $2, 'performer')", [event.id, solId]));
  await inTx((tx) => replaceLivePeople(tx, event.id, []));
  const { rows } = await db.query('select role from event_people where event_id = $1', [event.id]);
  assert.deepEqual(rows.map((r) => r.role), ['performer']);
});

test('markMerged: deletes and points each merged event at the kept one, copying every event_people row', async () => {
  const solId = await inTx((tx) => insertPerson(tx, { name: 'Sol' }));
  const lunaId = await inTx((tx) => insertPerson(tx, { name: 'Luna' }));
  const keep = await makeEvent('2036-01-01/merge-keep', { livePeopleIds: [solId] });
  const a = await makeEvent('2036-01-02/merge-a', { livePeopleIds: [solId] });
  const b = await makeEvent('2036-01-03/merge-b');
  await inTx((tx) => tx.query("insert into event_people (event_id, person_id, role) values ($1, $2, 'performer')", [b.id, lunaId]));

  await db.transaction((tx) => markMerged(tx, { mergeIds: [a.id, b.id], keepId: keep.id }), { actor: 'system' });

  const merged = await db.query('select id, merged_into, deleted_at, deleted_by from events where id = any($1::bigint[]) order by id', [[a.id, b.id]]);
  for (const row of merged.rows) {
    assert.equal(row.merged_into, keep.id);
    assert.ok(row.deleted_at instanceof Date);
    assert.equal(row.deleted_by, 'system');
  }
  const people = await db.query('select person_id, role from event_people where event_id = $1 order by role, person_id', [keep.id]);
  assert.deepEqual(people.rows, [{ person_id: solId, role: 'live' }, { person_id: lunaId, role: 'performer' }]);
});

test('moveItemsToEvent: places each item in the target event and reports where it came from', async () => {
  const from = await makeEvent('2037-01-01/move-from');
  const to = await makeEvent('2037-01-02/move-to');
  const inEvent = await inTx((tx) => insertItem(tx, { placement: 'event', eventId: from.id }));
  const unsorted = await inTx((tx) => insertItem(tx, { placement: 'unsorted' }));

  const moved = await inTx((tx) => moveItemsToEvent(tx, { itemIds: [inEvent, unsorted], toEventId: to.id }));
  assert.deepEqual(moved, [{ itemId: inEvent, fromEventId: from.id }, { itemId: unsorted, fromEventId: null }]);
  const { rows } = await db.query('select placement, event_id from items where id = any($1::bigint[])', [[inEvent, unsorted]]);
  assert.deepEqual(rows, [{ placement: 'event', event_id: to.id }, { placement: 'event', event_id: to.id }]);
});

test('resolveEventId is followMerged', () => {
  assert.equal(resolveEventId, followMerged);
});

test('takenSlugs: every slug starting with the prefix, deleted included', async () => {
  await inTx((tx) => insertEvent(tx, { slug: '2038-01-01/taken', occurredOn: '2038-01-01' }));
  const clash = await inTx((tx) => insertEvent(tx, { slug: '2038-01-01/taken-2', occurredOn: '2038-01-01' }));
  await inTx((tx) => hideEvent(tx, clash));
  await inTx((tx) => insertEvent(tx, { slug: '2038-01-02/taken', occurredOn: '2038-01-02' }));

  assert.deepEqual(await takenSlugs(db, '2038-01-01/taken'), new Set(['2038-01-01/taken', '2038-01-01/taken-2']));
  assert.deepEqual(await takenSlugs(db, '2038-01-01/%'), new Set(), 'the prefix is literal, not a pattern');
});
