// @ts-check
/**
 * `npm run migrate` (scripts/migrate.js): what a deploy runs before
 * going live -- the engine's and the site's migrations, each in its own
 * namespace, and nothing else (no seeding; `npm run setup` does that).
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { freshDb } from '../helpers/db.js';
import { ENGINE_MIGRATIONS, runMigrate } from '../../scripts/migrate.js';

const ENGINE_FILES = readdirSync(ENGINE_MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().map((f) => `engine/${f}`);

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
/** @type {string} */
let siteDir;

before(async () => {
  db = await freshDb({ migrated: false });
  siteDir = mkdtempSync(path.join(tmpdir(), 'fan-archive-migrate-'));
  mkdirSync(path.join(siteDir, 'migrations'));
  writeFileSync(path.join(siteDir, 'migrations', '001_site_extra.sql'), "insert into platforms values ('zz_site_platform');\n");
});
after(async () => {
  await db.end();
  rmSync(siteDir, { recursive: true, force: true });
});

test('runMigrate applies the engine, then the site namespace, and logs each file', async () => {
  /** @type {string[]} */
  const lines = [];
  const applied = await runMigrate({ db, siteDir, log: (line) => lines.push(line) });
  assert.deepEqual(applied, [...ENGINE_FILES, 'site/001_site_extra.sql']);
  assert.ok(lines.includes('migrated engine/001_initial.sql'));
  assert.ok(lines.includes('migrated site/001_site_extra.sql'));
  const { rows } = await db.query("select count(*)::int as n from people");
  assert.equal(rows[0].n, 0, 'migrate never seeds');
});

test('runMigrate again reports up to date', async () => {
  /** @type {string[]} */
  const lines = [];
  assert.deepEqual(await runMigrate({ db, siteDir, log: (line) => lines.push(line) }), []);
  assert.ok(lines.includes('migrations: up to date'));
});
