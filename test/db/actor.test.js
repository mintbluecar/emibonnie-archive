// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

test('an insert outside transaction() throws app.actor not set', async () => {
  await assert.rejects(
    db.query("insert into people (display_name, emoji, colour) values ('A', '🙂', '#112233')"),
    /app\.actor not set/,
  );
});

test("inside transaction(fn, { actor: 'system' }) it succeeds and created_by is 'system'", async () => {
  const row = await db.transaction(async (tx) => {
    const { rows } = await tx.query(
      "insert into people (display_name, emoji, colour) values ('A', '🙂', '#112233') returning created_by, updated_by",
    );
    return rows[0];
  }, { actor: 'system' });
  assert.equal(row.created_by, 'system');
  assert.equal(row.updated_by, 'system');
});

test('a delete outside transaction() throws app.actor not set too', async () => {
  await assert.rejects(db.query('delete from people'), /app\.actor not set/);
});

test('reads work outside transaction()', async () => {
  const { rows } = await db.query("select id from users where id = 'system'");
  assert.deepEqual(rows, [{ id: 'system' }]);
});

test('transaction() requires a non-empty actor', async () => {
  // @ts-expect-error -- deliberately missing actor
  await assert.rejects(db.transaction(async () => {}, {}), /actor/);
  await assert.rejects(db.transaction(async () => {}, { actor: '' }), /actor/);
});

test('a throwing fn rolls the transaction back, and the actor does not leak', async () => {
  await assert.rejects(db.transaction(async (tx) => {
    await tx.query("insert into users (id) values ('rolled-back')");
    throw new Error('boom');
  }, { actor: 'system' }), /boom/);
  const { rows } = await db.query("select count(*)::int as n, current_setting('app.actor', true) as a from users where id = 'rolled-back'");
  assert.equal(rows[0].n, 0);
  assert.ok(rows[0].a === '' || rows[0].a === null);
});

test('updated_at is bumped and updated_by set on update; settings (no created_by) works', async () => {
  const row = await db.transaction(async (tx) => {
    await tx.query("insert into users (id) values ('member-a')");
    await tx.query(`insert into settings (key, value) values ('k', '1')`);
    await tx.query(`update settings set value = '2' where key = 'k'`);
    return (await tx.query("select updated_by from settings where key = 'k'")).rows[0];
  }, { actor: 'member-a' });
  assert.equal(row.updated_by, 'member-a');
});

test('an update cannot change created_by or created_at', async () => {
  const row = await db.transaction(async (tx) => {
    await tx.query("insert into users (id) values ('member-c')");
    const { rows } = await tx.query("insert into people (display_name, emoji, colour) values ('C', '🙂', '#112233') returning id, created_at");
    await tx.query("update people set created_by = 'member-c', created_at = '2000-01-01T00:00:00Z', display_name = 'C2' where id = $1", [rows[0].id]);
    const after = (await tx.query('select created_by, created_at, display_name from people where id = $1', [rows[0].id])).rows[0];
    return { ...after, original: rows[0].created_at };
  }, { actor: 'system' });
  assert.equal(row.created_by, 'system');
  assert.equal(row.created_at.getTime(), row.original.getTime());
  assert.equal(row.display_name, 'C2');
});

test('the trigger functions cannot be executed by public', async () => {
  const { rows } = await db.query(
    `select p.proname, has_function_privilege('public', p.oid, 'execute') as public_exec
     from pg_proc p where p.proname in ('set_common', 'write_audit', 'grant_app_role') and p.pronamespace = current_schema()::regnamespace
     order by p.proname`,
  );
  assert.deepEqual(rows, [
    { proname: 'grant_app_role', public_exec: false },
    { proname: 'set_common', public_exec: false },
    { proname: 'write_audit', public_exec: false },
  ]);
});
