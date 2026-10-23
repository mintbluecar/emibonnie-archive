// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { addPerson, getPersonByHandle, listPeople, listPersonAccounts } from '../../src/repo/people.js';
import { getAccountByHandle, upsertAccount } from '../../src/repo/accounts.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };
const COLOUR = '#112233';

test("addPerson lowercases the handle and name when lowercaseNames is on: '@Host_X'/'Host' -> 'host_x'/'host'", async () => {
  const person = await db.transaction(
    (tx) =>
      addPerson(
        tx,
        { igHandle: '@Host_X', displayName: 'Host', emoji: '🙂', colour: COLOUR, featured: true },
        { lowercaseNames: true },
      ),
    system,
  );
  assert.equal(person.igHandle, 'host_x');
  assert.equal(person.displayName, 'host');
  assert.equal(person.featured, true);
});

test('addPerson with no featured option comes back featured: false', async () => {
  const person = await db.transaction(
    (tx) => addPerson(tx, { igHandle: 'unfeatured_e', displayName: 'E', emoji: '🙂', colour: COLOUR }, {}),
    system,
  );
  assert.equal(person.featured, false);
});

test('addPerson adopts an existing handle-only, unlinked Instagram account as the identity account', async () => {
  const accountId = await db.transaction((tx) => upsertAccount(tx, { platform: 'instagram', handle: 'mentioned_f' }), system);

  const person = await db.transaction(
    (tx) => addPerson(tx, { igHandle: '@Mentioned_F', displayName: 'F', emoji: '🙂', colour: COLOUR }, {}),
    system,
  );
  assert.equal(person.igHandle, 'mentioned_f');

  const { rows } = await db.query('select id, person_id, is_identity from accounts where id = $1', [accountId]);
  assert.equal(rows[0].person_id, person.id);
  assert.equal(rows[0].is_identity, true);

  const { rows: countRows } = await db.query(
    "select count(*)::int as n from accounts where platform = 'instagram' and lower(handle) = 'mentioned_f'",
  );
  assert.equal(countRows[0].n, 1);
});

test('addPerson throws duplicate person when the handle-only account is already linked to someone else', async () => {
  const other = await db.transaction(
    (tx) => addPerson(tx, { igHandle: 'owner_g', displayName: 'G', emoji: '🙂', colour: COLOUR }, {}),
    system,
  );
  const linked = await getAccountByHandle(db, 'instagram', 'owner_g');
  assert.equal(linked?.personId, other.id);

  await assert.rejects(
    db.transaction((tx) => addPerson(tx, { igHandle: '@Owner_G', displayName: 'G again', emoji: '🙂', colour: COLOUR }, {}), system),
    /duplicate person/,
  );
});

test('addPerson with the same IG handle twice throws duplicate person', async () => {
  await db.transaction(
    (tx) => addPerson(tx, { igHandle: 'dupe_a', displayName: 'A', emoji: '🙂', colour: COLOUR }, {}),
    system,
  );
  await assert.rejects(
    db.transaction((tx) => addPerson(tx, { igHandle: '@Dupe_A', displayName: 'A again', emoji: '🙂', colour: COLOUR }, {}), system),
    /duplicate person/,
  );
});

test('listPeople includes igHandle', async () => {
  await db.transaction(
    (tx) => addPerson(tx, { igHandle: 'listed_b', displayName: 'B', emoji: '🙂', colour: COLOUR }, {}),
    system,
  );
  const people = await listPeople(db);
  const found = people.find((p) => p.igHandle === 'listed_b');
  assert.ok(found, 'expected the added person in listPeople()');
  assert.equal(found.displayName, 'B');
});

test('getPersonByHandle finds a person by handle, case-insensitively and @-insensitively', async () => {
  await db.transaction(
    (tx) => addPerson(tx, { igHandle: 'finder_c', displayName: 'C', emoji: '🙂', colour: COLOUR }, {}),
    system,
  );
  const found = await getPersonByHandle(db, '@Finder_C');
  assert.ok(found);
  assert.equal(found.igHandle, 'finder_c');
  assert.equal(await getPersonByHandle(db, 'no_such_handle'), null);
});

test('listPersonAccounts lists every account linked to a known person', async () => {
  const person = await db.transaction(
    (tx) => addPerson(tx, { igHandle: 'linked_d', displayName: 'D', emoji: '🙂', colour: COLOUR }, {}),
    system,
  );
  await db.transaction(async (tx) => {
    const accountId = await upsertAccount(tx, { platform: 'x', handle: 'linked_d_x' });
    await tx.query('update accounts set person_id = $1 where id = $2', [person.id, accountId]);
  }, system);

  const accounts = await listPersonAccounts(db);
  const matches = accounts.filter((a) => a.personId === person.id);
  assert.deepEqual(
    matches.map((a) => a.platform).sort(),
    ['instagram', 'x'],
  );
});
