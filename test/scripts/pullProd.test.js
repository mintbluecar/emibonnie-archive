// @ts-check
/**
 * `npm run pull-prod` (scripts/pullProd.js): copies one database's rows
 * into a freshly migrated one, as production would be copied to `.devdb`.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb, ENGINE_MIGRATIONS } from '../helpers/db.js';
import { seededDeps } from '../helpers/ingest.js';
import { migrate } from '../../src/db/migrate.js';
import { copyDatabase } from '../../scripts/pullProd.js';

const DIRS = [{ namespace: 'engine', dir: ENGINE_MIGRATIONS }];

/** @type {any} */
let source;
/** @type {any} */
let target;

before(async () => {
  source = (await seededDeps()).db;
  await source.query("insert into sessions (token_hash, user_id, expires_at) values ('h', 'system', now() + interval '1 day')");
  target = await freshDb({ migrated: false });
  await migrate(target, { dirs: DIRS });
});
after(async () => { await source.end(); await target.end(); });

/** @param {any} db @param {string} table */
const count = async (db, table) => (await db.query(`select count(*)::int as n from "${table}"`)).rows[0].n;

test('copies every table row for row, leaves sessions behind, and new rows still get fresh ids', async () => {
  const counts = await copyDatabase({ source, target });
  assert.ok(counts.items > 0, 'the seeded items were copied');
  assert.equal(counts.sessions, undefined, 'sessions are not copied');
  assert.equal(await count(target, 'sessions'), 0);
  for (const table of Object.keys(counts)) assert.equal(await count(target, table), await count(source, table), table);
  assert.equal(await count(target, 'audit_log'), await count(source, 'audit_log'), 'the copy itself writes no audit rows');

  const same = await target.query('select id, slug, updated_at from events order by id');
  assert.deepEqual(same.rows, (await source.query('select id, slug, updated_at from events order by id')).rows);

  const maxId = (await source.query('select max(id)::int as n from people')).rows[0].n;
  const { rows } = await target.transaction((tx) => tx.query(
    "insert into people (display_name, emoji, colour) values ('new person', '⭐', '#123456') returning id", []), { actor: 'system' });
  assert.ok(Number(rows[0].id) > maxId, 'identity counters moved past the copied ids');
});

test('refuses when the databases applied different migrations', async () => {
  const bare = await freshDb({ migrated: false });
  await bare.query('create table schema_migrations (namespace text, name text, sha256 text, applied_at timestamptz, primary key (namespace, name))');
  await assert.rejects(copyDatabase({ source, target: bare }), /this checkout has migrations|production has migrations/);
  await bare.end();
});
