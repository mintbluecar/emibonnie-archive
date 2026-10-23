// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb, usingPostgres, withTempRole } from '../helpers/db.js';
import { insertItem, insertPerson } from '../helpers/seed.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };

/** @param {string} table @param {string | number} key */
async function auditRows(table, key) {
  const { rows } = await db.query(
    'select table_name, row_key, action, actor, changes from audit_log where table_name = $1 and row_key = $2 order by id',
    [table, String(key)],
  );
  return rows;
}

test("inserting user 'x' logs row_key 'x', action 'insert', changes null (text-key regression)", async () => {
  await db.transaction((tx) => tx.query("insert into users (id, display_name) values ('x', 'X')"), system);
  assert.deepEqual(await auditRows('users', 'x'), [
    { table_name: 'users', row_key: 'x', action: 'insert', actor: 'system', changes: null },
  ]);
});

test("updating a person's colour logs changes { colour: old } only", async () => {
  const id = await db.transaction((tx) => insertPerson(tx, { colour: '#111111' }), system);
  await db.transaction((tx) => tx.query("update people set colour = '#222222' where id = $1", [id]), system);
  const updates = (await auditRows('people', id)).filter((r) => r.action === 'update');
  assert.deepEqual(updates.map((r) => r.changes), [{ colour: '#111111' }]);
});

test('an update that changes nothing logs nothing', async () => {
  const id = await db.transaction((tx) => insertPerson(tx), system);
  await db.transaction((tx) => tx.query('update people set colour = colour where id = $1', [id]), system);
  const actions = (await auditRows('people', id)).map((r) => r.action);
  assert.deepEqual(actions, ['insert']);
});

test("inserting an item_people row logs table 'item_people' with row_key = the item id", async () => {
  const { itemId } = await db.transaction(async (tx) => {
    const personId = await insertPerson(tx);
    return { itemId: await insertItem(tx), personId };
  }, system);
  const personId = await db.transaction((tx) => insertPerson(tx, { name: 'B' }), system);
  await db.transaction(
    (tx) => tx.query("insert into item_people (item_id, person_id, role) values ($1, $2, 'present')", [itemId, personId]),
    system,
  );
  const rows = await auditRows('item_people', itemId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, 'insert');
  assert.equal(rows[0].row_key, String(itemId));
});

test('a delete logs the full old row', async () => {
  const id = await db.transaction((tx) => insertPerson(tx, { name: 'Gone' }), system);
  const personId = id;
  const itemId = await db.transaction((tx) => insertItem(tx), system);
  await db.transaction(async (tx) => {
    await tx.query("insert into item_people (item_id, person_id, role) values ($1, $2, 'about')", [itemId, personId]);
    await tx.query('delete from item_people where item_id = $1', [itemId]);
  }, { actor: 'system' });
  const del = (await auditRows('item_people', itemId)).find((r) => r.action === 'delete');
  assert.equal(del.changes.person_id, personId);
  assert.equal(del.changes.role, 'about');
});

test('the audit row records the actor that made the change', async () => {
  await db.transaction((tx) => tx.query("insert into users (id) values ('member-b')"), system);
  await db.transaction((tx) => tx.query("update users set display_name = 'B' where id = 'member-b'"), { actor: 'member-b' });
  const update = (await auditRows('users', 'member-b')).find((r) => r.action === 'update');
  assert.equal(update.actor, 'member-b');
  assert.deepEqual(update.changes, { display_name: null });
});

test('tables outside the audited set (tags) log nothing and need no actor', async () => {
  await db.query("insert into tags (kind, display, norm) values ('hashtag', '#A', 'a')");
  const { rows } = await db.query("select count(*)::int as n from audit_log where table_name = 'tags'");
  assert.equal(rows[0].n, 0);
});

test('the app role cannot delete or update audit_log, yet its writes are still audited', async (t) => {
  // PGlite runs as a superuser and supports create role / set role, so this runs on both;
  // on Postgres it exercises a real non-owner role.
  t.diagnostic(usingPostgres ? 'running on Postgres' : 'running on PGlite');
  await withTempRole(db, async (role) => {
    await db.transaction((tx) => tx.query('select grant_app_role($1::regrole)', [`"${role}"`]), system);
    const asApp = async (/** @type {string} */ sql) => db.transaction(async (tx) => {
      await tx.query(`set local role "${role}"`);
      return tx.query(sql);
    }, system);
    await assert.rejects(asApp('delete from audit_log'), (/** @type {any} */ err) => err.code === '42501');
    await assert.rejects(asApp("update audit_log set actor = 'nobody'"), (/** @type {any} */ err) => err.code === '42501');
    await assert.rejects(asApp('truncate audit_log'), (/** @type {any} */ err) => err.code === '42501');
    const inserted = await asApp("insert into people (display_name, emoji, colour) values ('App', '🙂', '#123456') returning id");
    const rows = await auditRows('people', inserted.rows[0].id);
    assert.deepEqual(rows.map((r) => r.action), ['insert']);
  });
});
