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

test('the setup CLI refuses to run with no target: no DATABASE_URL and no PGLITE_DIR exits 1 with the reason', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const script = fileURLToPath(new URL('../../scripts/setup.js', import.meta.url));
  const env = { ...process.env, DATABASE_URL: '', PGLITE_DIR: '', VERCEL: '', SITE_DIR: 'examples/solluna' };
  delete env.NODE_TEST_CONTEXT;
  const res = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /DATABASE_URL is not set \(set PGLITE_DIR to migrate a local dev database\)/);
  assert.doesNotMatch(res.stdout, /migrated|seeded/, 'nothing ran against a throwaway database');
});
