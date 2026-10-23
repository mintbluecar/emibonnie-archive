// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb, withTempRole } from '../helpers/db.js';
import { grantAppRole } from '../../src/repo/roles.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };

test('grantAppRole grants select on this schema to the given role', async () => {
  await withTempRole(db, async (role) => {
    await db.transaction((tx) => grantAppRole(tx, `"${role}"`), system);
    const { rows } = await db.query("select has_table_privilege($1, 'people', 'select') as ok", [role]);
    assert.equal(rows[0].ok, true);
  });
});
