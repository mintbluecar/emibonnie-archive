// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

test('rowCount is the same on both drivers for selects and DML', async () => {
  const select = await db.query('select * from (values (1), (2)) as v(n)');
  assert.equal(select.rowCount, 2);
  const empty = await db.query('select 1 where false');
  assert.equal(empty.rowCount, 0);
  const counts = await db.transaction(async (tx) => {
    const inserted = await tx.query("insert into users (id) values ('rc-a'), ('rc-b'), ('rc-c')");
    const updated = await tx.query("update users set display_name = 'R' where id like 'rc-%'");
    const returning = await tx.query("update users set display_name = 'S' where id like 'rc-%' returning id");
    const none = await tx.query("update users set display_name = 'T' where id = 'no-such-user'");
    const txSelect = await tx.query("select id from users where id like 'rc-%'");
    return { inserted: inserted.rowCount, updated: updated.rowCount, returning: returning.rowCount, rows: returning.rows.length, none: none.rowCount, txSelect: txSelect.rowCount };
  }, { actor: 'system' });
  assert.deepEqual(counts, { inserted: 3, updated: 3, returning: 3, rows: 3, none: 0, txSelect: 3 });
});
