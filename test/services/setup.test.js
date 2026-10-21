// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb, withTempRole } from '../helpers/db.js';
import { loadSite } from '../../src/site/loadSite.js';
import { missingKinds, runSetup } from '../../scripts/setup.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
const site = loadSite('examples/solluna');

before(async () => { db = await freshDb({ migrated: false }); });
after(async () => { await db.end(); });

test('missingKinds: the registry codes with no matching db code', () => {
  assert.deepEqual(missingKinds(['translation', 'fancomic'], ['translation']), ['fancomic']);
  assert.deepEqual(missingKinds(['translation'], ['translation']), []);
});

test('runSetup migrates, seeds, and logs a summary', async () => {
  /** @type {string[]} */
  const lines = [];
  await runSetup({ db, site, log: (line) => lines.push(line) });

  assert.ok(lines.some((line) => line === 'migrated engine/001_initial.sql'));
  assert.ok(lines.some((line) => line.startsWith(`seeded ${site.featuredPeople.length} people`)));
  assert.ok(lines.some((line) => line.startsWith('hint:')));
});

test('runSetup fails with a hint when the registry names a kind with no item_kinds row', async () => {
  await assert.rejects(
    runSetup({ db, site, registryCodes: ['translation', 'no-such-kind'], log: () => {} }),
    /no-such-kind/,
  );
});

test('runSetup grants the app role when APP_DB_ROLE is set', async () => {
  await withTempRole(db, async (role) => {
    process.env.APP_DB_ROLE = `"${role}"`;
    /** @type {string[]} */
    const lines = [];
    try {
      await runSetup({ db, site, log: (line) => lines.push(line) });
    } finally {
      delete process.env.APP_DB_ROLE;
    }
    assert.ok(lines.some((line) => line.includes('granted the app role')));
    const { rows } = await db.query('select has_table_privilege($1, \'people\', \'select\') as ok', [role]);
    assert.equal(rows[0].ok, true);
  });
});
