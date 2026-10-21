// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { addPerson, getPersonByHandle, listPeople, listPersonAccounts } from '../../src/repo/people.js';
import { upsertAccount } from '../../src/repo/accounts.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

const system = { actor: 'system' };
const COLOUR = '#112233';

test("addPerson lowercases the handle and name when lowercaseNames is on: '@Host_X'/'Host' -> 'host_x'/'host'", async () => {
  const person = await db.transaction(
    (tx) => addPerson(tx, { igHandle: '@Host_X', displayName: 'Host', emoji: '🙂', colour: COLOUR }, { lowercaseNames: true }),
    system,
  );
  assert.equal(person.igHandle, 'host_x');
  assert.equal(person.displayName, 'host');
  assert.equal(person.featured, true);
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
