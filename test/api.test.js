// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeDeps } from '../api/index.js';
import { dbOptionsFromEnv } from '../src/db/client.js';

test('in production (VERCEL set) a missing DATABASE_URL fails fast and never falls back to PGlite', () => {
  assert.throws(() => dbOptionsFromEnv({ VERCEL: '1' }), /DATABASE_URL is not set/);
  assert.throws(() => dbOptionsFromEnv({ VERCEL: '1', DATABASE_URL: '', PGLITE_DIR: '.devdb' }), /DATABASE_URL is not set/);
  assert.throws(() => makeDeps({ VERCEL: '1' }), /DATABASE_URL is not set/);
  assert.deepEqual(dbOptionsFromEnv({ VERCEL: '1', DATABASE_URL: 'postgres://u@h/d' }), { url: 'postgres://u@h/d' });
});

test('outside production the dev fallbacks stay available', async () => {
  assert.deepEqual(dbOptionsFromEnv({ PGLITE_DIR: '.devdb' }), { url: undefined, dir: '.devdb' });
  const deps = makeDeps({});
  try {
    assert.equal(typeof deps.db.query, 'function');
    assert.equal(typeof deps.now().getTime(), 'number');
  } finally {
    await deps.db.end();
  }
});
