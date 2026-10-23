// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { findAccountForView, getAccount, getAccountByHandle, upsertAccount } from '../../src/repo/accounts.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };

test('a handle-only account adopts an external id instead of duplicating: 1 row, with the external id', async () => {
  const firstId = await db.transaction((tx) => upsertAccount(tx, { platform: 'x', handle: 'clipper_one' }), system);
  const secondId = await db.transaction(
    (tx) => upsertAccount(tx, { platform: 'x', externalId: '7001', handle: 'clipper_one' }),
    system,
  );
  assert.equal(firstId, secondId);

  const { rows } = await db.query("select count(*)::int as n from accounts where platform = 'x' and lower(handle) = 'clipper_one'");
  assert.equal(rows[0].n, 1);

  const account = await getAccount(db, secondId);
  assert.equal(account?.externalId, '7001');
});

test('a handle change by external id updates the existing row', async () => {
  const id = await db.transaction(
    (tx) => upsertAccount(tx, { platform: 'x', externalId: '7002', handle: 'old_handle' }),
    system,
  );
  const again = await db.transaction(
    (tx) => upsertAccount(tx, { platform: 'x', externalId: '7002', handle: 'new_handle' }),
    system,
  );
  assert.equal(id, again);
  const account = await getAccount(db, id);
  assert.equal(account?.handle, 'new_handle');
});

test('getAccountByHandle prefers an external-id row over a handle-only one', async () => {
  await db.transaction((tx) => upsertAccount(tx, { platform: 'x', handle: 'ambiguous' }), system);
  const withExternal = await db.transaction(
    (tx) => upsertAccount(tx, { platform: 'x', externalId: '7003', handle: 'ambiguous_real' }),
    system,
  );
  // Force two distinct rows sharing no handle, then re-point one to the same handle via a direct update
  // so both a handle-only row and an external-id row exist for 'ambiguous' -- exercising the tiebreak.
  await db.transaction((tx) => tx.query('update accounts set handle = $1 where id = $2', ['ambiguous', withExternal]), system);

  const found = await getAccountByHandle(db, 'x', 'ambiguous');
  assert.equal(found?.id, withExternal);
  assert.equal(found?.externalId, '7003');
});

test('getAccountByHandle returns null when nothing matches', async () => {
  assert.equal(await getAccountByHandle(db, 'x', 'never_seen_handle'), null);
});

test('a handle change remembers the old handle; findAccountForView resolves it, preferring a current holder', async () => {
  const id = await db.transaction((tx) => upsertAccount(tx, { platform: 'x', externalId: '7101', handle: 'Before_Name' }), system);
  await db.transaction((tx) => upsertAccount(tx, { platform: 'x', externalId: '7101', handle: 'after_name' }), system);
  await db.transaction((tx) => upsertAccount(tx, { platform: 'x', externalId: '7101', handle: 'After_Name' }), system);
  const { rows } = await db.query('select meta from accounts where id = $1', [id]);
  assert.deepEqual(rows[0].meta.previousHandles, ['before_name']);

  const old = await findAccountForView(db, 'x', 'before_name');
  assert.equal(old?.id, id);
  assert.equal(old?.handle, 'After_Name');
  assert.equal(old?.current, false);
  assert.equal((await findAccountForView(db, 'x', 'after_name'))?.current, true);

  const taker = await db.transaction((tx) => upsertAccount(tx, { platform: 'x', externalId: '7102', handle: 'before_name' }), system);
  assert.equal((await findAccountForView(db, 'x', 'BEFORE_NAME'))?.id, taker);
  assert.equal(await findAccountForView(db, 'x', 'never_seen'), null);
});
