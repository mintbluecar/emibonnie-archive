// @ts-check
/**
 * `runCli` (scripts/cli.js): the one place a CLI script picks its
 * database, its site directory, parses its arguments, always ends the
 * db, and prints only a safe summary of a failure.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { createDb } from '../../src/db/client.js';
import { dbTargetOf, errorText, runCli, siteDirOf } from '../../scripts/cli.js';

/** Saves and restores the env vars `runCli` reads, and `process.exitCode`. */
async function withEnv(/** @type {Record<string, string|undefined>} */ patch, /** @type {() => Promise<void>} */ fn) {
  const saved = { DATABASE_URL: process.env.DATABASE_URL, PGLITE_DIR: process.env.PGLITE_DIR };
  const savedExitCode = process.exitCode;
  Object.assign(process.env, patch);
  process.exitCode = undefined;
  try {
    await fn();
  } finally {
    Object.assign(process.env, saved);
    process.exitCode = savedExitCode;
  }
}

test('runCli refuses an in-memory database when one is required', async () => {
  /** @type {string[]} */
  const errs = [];
  const originalError = console.error;
  let called = false;
  await withEnv({ DATABASE_URL: '', PGLITE_DIR: '' }, async () => {
    console.error = (/** @type {string} */ line) => errs.push(line);
    try {
      await runCli(async () => { called = true; }, { db: 'required' });
    } finally {
      console.error = originalError;
    }
    assert.equal(called, false, 'main never ran against a throwaway database');
    assert.equal(process.exitCode, 1);
    assert.match(errs.join('\n'), /DATABASE_URL is not set/);
  });
});

test('runCli ends the db when main throws', async () => {
  const key = `memory://fan-archive-cli-test-${randomBytes(4).toString('hex')}`;
  await withEnv({ DATABASE_URL: '', PGLITE_DIR: key }, async () => {
    await runCli(async ({ db }) => {
      await /** @type {any} */ (db).transaction((/** @type {any} */ tx) => tx.exec('create table probe (x int)'), { actor: 'system' });
      throw new Error('boom');
    }, { db: 'required' });
    assert.equal(process.exitCode, 1);

    // The earlier `Db` was ended (released), so reconnecting at the same
    // key opens a brand-new, empty PGlite instance -- `probe` is gone.
    const reconnected = createDb({ dir: key });
    try {
      const { rows } = await reconnected.query("select to_regclass('probe') as t");
      assert.equal(rows[0].t, null, 'the earlier db was ended, not left open with its table');
    } finally {
      await reconnected.end();
    }
  });
});

test('import with an empty env fails before reading its input', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const script = fileURLToPath(new URL('../../scripts/import.js', import.meta.url));
  const env = { ...process.env, DATABASE_URL: '', PGLITE_DIR: '', VERCEL: '' };
  delete env.NODE_TEST_CONTEXT;
  const res = spawnSync(process.execPath, [script, '--notion', '/no/such/file.csv'], { env, encoding: 'utf8' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /DATABASE_URL is not set/);
  assert.doesNotMatch(res.stderr, /ENOENT|no such file/, 'never tried to read the (nonexistent) input file');
});

test('siteDirOf: SITE_DIR, or "site"', () => {
  assert.equal(siteDirOf({}), 'site');
  assert.equal(siteDirOf({ SITE_DIR: 'examples/solluna' }), 'examples/solluna');
});

test('dbTargetOf: a DATABASE_URL or a PGLITE_DIR is a target; neither throws', () => {
  assert.deepEqual(dbTargetOf({ DATABASE_URL: 'postgres://x' }), { url: 'postgres://x', dir: undefined });
  assert.deepEqual(dbTargetOf({ PGLITE_DIR: '.devdb' }), { url: undefined, dir: '.devdb' });
  assert.throws(() => dbTargetOf({ DATABASE_URL: '', PGLITE_DIR: '' }), /DATABASE_URL is not set \(set PGLITE_DIR/);
});

test('errorText: the message, else the code, else a generic line -- never a connection string', () => {
  assert.equal(errorText(new Error('relation "x" does not exist')), 'relation "x" does not exist');
  assert.equal(errorText(Object.assign(new Error(''), { code: 'ECONNREFUSED' })), 'ECONNREFUSED');
  assert.equal(errorText({}), 'database connection failed');
  assert.equal(errorText(null), 'database connection failed');
});
