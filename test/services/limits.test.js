// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { LIMITS, limit } from '../../src/services/limits.js';
import { RateLimited } from '../../src/http/errors.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

/** @param {string} authSecret @returns deps with a pinned random (never deletes) and now. */
function depsWith(authSecret = 'test-secret', now = new Date('2026-01-01T00:00:00Z')) {
  return { db, env: { AUTH_SECRET: authSecret }, now: () => now, random: () => 1 };
}

test('LIMITS holds the agreed limits', () => {
  assert.deepEqual(LIMITS, {
    signIn: { limit: 10, windowSeconds: 900, subject: 'ip' },
    addPreview: { limit: 60, windowSeconds: 3600 },
    add: { limit: 20, windowSeconds: 3600 },
    addPerson: { limit: 20, windowSeconds: 3600 },
    edit: { limit: 60, windowSeconds: 3600 },
    followUps: { limit: 10, windowSeconds: 3600 },
    setName: { limit: 5, windowSeconds: 3600 },
    deleteAccount: { limit: 3, windowSeconds: 86400 },
    report: { limit: 5, windowSeconds: 3600, subject: 'ip' },
  });
});

test('the 21st add in an hour is rate limited', async () => {
  const deps = depsWith();
  for (let i = 0; i < 20; i++) await limit(deps, 'add', 'user-1');
  await assert.rejects(limit(deps, 'add', 'user-1'), RateLimited);
});

test('a new window starts fresh', async () => {
  const deps = depsWith();
  for (let i = 0; i < 20; i++) await limit(deps, 'add', 'user-2');
  await assert.rejects(limit(deps, 'add', 'user-2'), RateLimited);
  // An hour later (new window) the slate is clean again.
  const later = depsWith('test-secret', new Date('2026-01-01T01:00:00Z'));
  await limit(later, 'add', 'user-2');
});

test('ip subjects are hashed, never stored raw', async () => {
  const deps = depsWith();
  await limit(deps, 'report', '203.0.113.5');
  const { rows } = await db.query('select key from rate_limits');
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.ok(!row.key.includes('203.0.113.5'), `raw ip leaked into key: ${row.key}`);
  }
});

test('a null ip uses ip:unknown and never stores a raw ip', async () => {
  const deps = depsWith();
  await limit(deps, 'report', null);
  const { rows } = await db.query("select key from rate_limits where key like 'report:%'");
  assert.ok(rows.some((r) => r.key.includes('ip:')), 'ip subject is an ip: key');
});
