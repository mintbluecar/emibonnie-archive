// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { insertEvent, insertItem, insertPerson, insertSource } from '../helpers/seed.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => {
  db = await freshDb();
  await db.transaction((tx) => tx.query("insert into item_kinds values ('zz')"), { actor: 'system' });
});
after(async () => { await db.end(); });

/** @param {(tx: any) => Promise<unknown>} fn */
const write = (fn) => db.transaction(fn, { actor: 'system' });
/** @param {string} code */
const pgError = (code) => (/** @type {any} */ err) => err.code === code;

test("placement 'event' with a null event_id is rejected", async () => {
  await assert.rejects(write((tx) => insertItem(tx, { placement: 'event', eventId: null })), pgError('23514'));
});

test("placement 'event' with an event_id is accepted; another placement with an event_id is rejected", async () => {
  const eventId = await write((tx) => insertEvent(tx, { slug: 'placed' }));
  await write((tx) => insertItem(tx, { placement: 'event', eventId }));
  await assert.rejects(write((tx) => insertItem(tx, { placement: 'post', eventId })), pgError('23514'));
});

test('deleted_reason set without deleted_at is rejected', async () => {
  await assert.rejects(write((tx) => insertItem(tx, { deletedReason: 'spam' })), pgError('23514'));
});

test('a second primary source on the same item is rejected', async () => {
  const itemId = await write((tx) => insertItem(tx));
  await write((tx) => insertSource(tx, { itemId, externalId: '1001' }));
  await assert.rejects(write((tx) => insertSource(tx, { itemId, externalId: '1002' })), pgError('23505'));
  await write((tx) => insertSource(tx, { itemId, externalId: '1003', role: 'follow_up' }));
});

test('the same primary tweet under two kinds is allowed, but not twice in one kind', async () => {
  const a = await write((tx) => insertItem(tx));
  const b = await write((tx) => insertItem(tx, { kind: 'zz' }));
  const c = await write((tx) => insertItem(tx));
  await write((tx) => insertSource(tx, { itemId: a, externalId: '2001' }));
  await write((tx) => insertSource(tx, { itemId: b, kind: 'zz', externalId: '2001' }));
  await assert.rejects(write((tx) => insertSource(tx, { itemId: c, externalId: '2001' })), pgError('23505'));
});

test("a source whose kind does not match its item's kind is rejected", async () => {
  const itemId = await write((tx) => insertItem(tx));
  await assert.rejects(write((tx) => insertSource(tx, { itemId, kind: 'zz', externalId: '2500' })), pgError('23503'));
});

test('a translations row pointing at an item of another kind is rejected', async () => {
  const itemId = await write((tx) => insertItem(tx, { kind: 'zz' }));
  await assert.rejects(write((tx) => tx.query('insert into translations (item_id) values ($1)', [itemId])), pgError('23503'));
  const ok = await write((tx) => insertItem(tx));
  await write((tx) => tx.query('insert into translations (item_id) values ($1)', [ok]));
});

test('a second identity account for the same person is rejected', async () => {
  const personId = await write((tx) => insertPerson(tx));
  const account = "insert into accounts (platform, handle, person_id, is_identity) values ('instagram', $1, $2, true)";
  await write((tx) => tx.query(account, ['first', personId]));
  await assert.rejects(write((tx) => tx.query(account, ['second', personId])), pgError('23505'));
});

test('a translation_speakers row with both person_id and role is rejected (and with neither)', async () => {
  const personId = await write((tx) => insertPerson(tx));
  const itemId = await write(async (tx) => {
    const id = await insertItem(tx);
    await tx.query('insert into translations (item_id) values ($1)', [id]);
    return id;
  });
  const speaker = 'insert into translation_speakers (item_id, marker, person_id, role) values ($1, $2, $3, $4)';
  await assert.rejects(write((tx) => tx.query(speaker, [itemId, 'A', personId, 'host'])), pgError('23514'));
  await assert.rejects(write((tx) => tx.query(speaker, [itemId, 'B', null, null])), pgError('23514'));
  await write((tx) => tx.query(speaker, [itemId, 'C', null, 'crowd']));
  await assert.rejects(write((tx) => tx.query(speaker, [itemId, 'D', null, 'nobody'])), pgError('23514'));
});

test('slugs stay unique even after a soft delete', async () => {
  const id = await write((tx) => insertEvent(tx, { slug: 'forever' }));
  await write((tx) => tx.query("update events set deleted_at = now(), deleted_by = 'system' where id = $1", [id]));
  await assert.rejects(write((tx) => insertEvent(tx, { slug: 'forever' })), pgError('23505'));
});

test('translation parts are keyed by (item, position) and searchable by trigram', async () => {
  const itemId = await write(async (tx) => {
    const id = await insertItem(tx);
    await tx.query('insert into translations (item_id) values ($1)', [id]);
    await tx.query("insert into translation_parts (item_id, position, body) values ($1, 0, 'สวัสดีครับ hello')", [id]);
    return id;
  });
  await assert.rejects(
    write((tx) => tx.query("insert into translation_parts (item_id, position, body) values ($1, 0, 'again')", [itemId])),
    pgError('23505'),
  );
  const { rows } = await db.query("select item_id from translation_parts where body ilike '%วัสดี%'");
  assert.deepEqual(rows.map((r) => r.item_id), [itemId]);
});
