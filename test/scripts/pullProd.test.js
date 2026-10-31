// @ts-check
/**
 * `npm run pull-prod` (scripts/pullProd.js): copies one database's rows
 * into a freshly migrated one, as production would be copied to `.devdb`.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDb } from '../../src/db/client.js';
import { freshDb, ENGINE_MIGRATIONS } from '../helpers/db.js';
import { seededDeps } from '../helpers/ingest.js';
import { migrate } from '../../src/db/migrate.js';
import { copyDatabase, pullInto } from '../../scripts/pullProd.js';

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

/**
 * A temp folder holding a fake checkout (`repo/`) beside room for target
 * dirs, so nothing is written into this tree. Caller removes `root`.
 */
function scratch() {
  const root = mkdtempSync(path.join(tmpdir(), 'fan-archive-pull-prod-'));
  const repoRoot = path.join(root, 'repo');
  mkdirSync(repoRoot);
  return { root, repoRoot };
}

/** A source that can't be reached, like a bad DATABASE_URL. */
const unreachable = { query: async () => { throw new Error('connect ECONNREFUSED'); }, end: async () => {} };

test('pullInto (final review M6): a source that cannot be reached leaves the existing target untouched, and no temp dir behind', async () => {
  const { root, repoRoot } = scratch();
  try {
    const dir = path.join(root, '.devdb');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'PG_VERSION'), '18\n');
    await assert.rejects(pullInto({ source: unreachable, dir, dirs: DIRS, repoRoot }), /ECONNREFUSED/);
    assert.equal(readFileSync(path.join(dir, 'PG_VERSION'), 'utf8'), '18\n', 'the old target is still there');
    assert.deepEqual(readdirSync(root).sort(), ['.devdb', 'repo'], 'no temp dir left behind');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pullInto (final review M6): a source with different migrations leaves the existing target untouched', async () => {
  const { root, repoRoot } = scratch();
  const bare = createDb();
  try {
    await bare.query('create table schema_migrations (namespace text, name text, sha256 text, applied_at timestamptz, primary key (namespace, name))');
    const dir = path.join(root, '.devdb');
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'PG_VERSION'), '18\n');
    await assert.rejects(pullInto({ source: bare, dir, dirs: DIRS, repoRoot }), /this checkout has migrations/);
    assert.equal(readFileSync(path.join(dir, 'PG_VERSION'), 'utf8'), '18\n');
    assert.deepEqual(readdirSync(root).sort(), ['.devdb', 'repo']);
  } finally {
    await bare.end();
    rmSync(root, { recursive: true, force: true });
  }
});

test('pullInto (final review M6): refuses the repo root, a parent of it, and a non-empty folder that is not a PGlite data dir -- deleting nothing', async () => {
  const { root, repoRoot } = scratch();
  try {
    writeFileSync(path.join(repoRoot, 'package.json'), '{}');
    await assert.rejects(pullInto({ source, dir: repoRoot, dirs: DIRS, repoRoot }), /refusing/);
    await assert.rejects(pullInto({ source, dir: root, dirs: DIRS, repoRoot }), /refusing/);
    const notes = path.join(root, 'notes');
    mkdirSync(notes);
    writeFileSync(path.join(notes, 'keep.txt'), 'mine');
    await assert.rejects(pullInto({ source, dir: notes, dirs: DIRS, repoRoot }), /refusing/);
    assert.equal(readFileSync(path.join(notes, 'keep.txt'), 'utf8'), 'mine');
    assert.ok(existsSync(path.join(repoRoot, 'package.json')));
    assert.deepEqual(readdirSync(root).sort(), ['notes', 'repo']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pullInto (final review M6): builds a new target, or replaces an existing PGlite data dir, with the copied rows', async () => {
  const { root, repoRoot } = scratch();
  try {
    const items = await count(source, 'items');
    for (const dir of [path.join(root, 'fresh'), path.join(root, 'empty'), path.join(root, 'old-devdb')]) {
      if (dir.endsWith('empty')) mkdirSync(dir);
      if (dir.endsWith('old-devdb')) {
        mkdirSync(dir);
        writeFileSync(path.join(dir, 'PG_VERSION'), '18\n');
        writeFileSync(path.join(dir, 'stale-file'), 'old');
      }
      const counts = await pullInto({ source, dir, dirs: DIRS, repoRoot });
      assert.equal(counts.items, items, dir);
      assert.ok(!existsSync(path.join(dir, 'stale-file')), `${dir}: the old contents are gone`);
      const copied = createDb({ dir });
      try {
        assert.equal(await count(copied, 'items'), items, dir);
      } finally {
        await copied.end();
      }
    }
    assert.deepEqual(readdirSync(root).sort(), ['empty', 'fresh', 'old-devdb', 'repo'], 'no temp or old dirs left behind');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
