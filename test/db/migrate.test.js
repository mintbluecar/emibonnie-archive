// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, copyFileSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { migrate } from '../../src/db/migrate.js';
import { ENGINE_MIGRATIONS, freshDb } from '../helpers/db.js';

const engine = { namespace: 'engine', dir: ENGINE_MIGRATIONS };
/** Every engine migration, in order -- 001_initial.sql first, then any a kind or a later release added. */
const ENGINE_FILES = readdirSync(ENGINE_MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().map((f) => `engine/${f}`);

test('the first run applies engine/001_initial.sql (then every later engine file) and the second applies nothing', async () => {
  const db = await freshDb({ migrated: false });
  try {
    assert.equal(ENGINE_FILES[0], 'engine/001_initial.sql');
    assert.deepEqual(await migrate(db, { dirs: [engine] }), ENGINE_FILES);
    assert.deepEqual(await migrate(db, { dirs: [engine] }), []);
    const { rows } = await db.query('select namespace, name, length(sha256) as len, applied_at from schema_migrations order by name');
    assert.equal(rows.length, ENGINE_FILES.length);
    assert.equal(rows[0].namespace, 'engine');
    assert.equal(rows[0].name, '001_initial.sql');
    assert.equal(rows[0].len, 64);
    assert.ok(rows[0].applied_at instanceof Date);
  } finally {
    await db.end();
  }
});

test('editing an applied file makes the next run throw checksum mismatch', async () => {
  const db = await freshDb({ migrated: false });
  const dir = mkdtempSync(path.join(tmpdir(), 'fa-migrate-'));
  copyFileSync(path.join(ENGINE_MIGRATIONS, '001_initial.sql'), path.join(dir, '001_initial.sql'));
  try {
    await migrate(db, { dirs: [{ namespace: 'engine', dir }] });
    appendFileSync(path.join(dir, '001_initial.sql'), '\n-- edited\n');
    await assert.rejects(migrate(db, { dirs: [{ namespace: 'engine', dir }] }), /checksum mismatch/);
  } finally {
    await db.end();
  }
});

test('a site namespace 001_x.sql applies independently of engine/001', async () => {
  const db = await freshDb({ migrated: false });
  const siteDir = mkdtempSync(path.join(tmpdir(), 'fa-site-'));
  writeFileSync(path.join(siteDir, '001_x.sql'), 'create table site_x (id int primary key);\n');
  try {
    await migrate(db, { dirs: [engine] });
    const applied = await migrate(db, { dirs: [engine, { namespace: 'site', dir: siteDir }] });
    assert.deepEqual(applied, ['site/001_x.sql']);
    const { rows } = await db.query('select count(*)::int as n from site_x');
    assert.equal(rows[0].n, 0);
  } finally {
    await db.end();
  }
});

test('a missing directory (a site with no migrations yet) is skipped', async () => {
  const db = await freshDb({ migrated: false });
  try {
    const missing = path.join(tmpdir(), 'fa-no-such-dir-' + Date.now());
    assert.deepEqual(await migrate(db, { dirs: [engine, { namespace: 'site', dir: missing }] }), ENGINE_FILES);
  } finally {
    await db.end();
  }
});

test('a failing migration rolls back and is not recorded', async () => {
  const db = await freshDb({ migrated: false });
  const dir = mkdtempSync(path.join(tmpdir(), 'fa-bad-'));
  writeFileSync(path.join(dir, '001_bad.sql'), 'create table half_done (id int);\nselect 1/0;\n');
  try {
    await assert.rejects(migrate(db, { dirs: [{ namespace: 'site', dir }] }));
    const { rows } = await db.query("select to_regclass('half_done') as t, (select count(*)::int from schema_migrations) as n");
    assert.equal(rows[0].t, null);
    assert.equal(rows[0].n, 0);
  } finally {
    await db.end();
  }
});
