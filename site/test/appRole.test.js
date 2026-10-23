// @ts-check
/**
 * Fix round 4, N1: `site/scripts/app-role.mjs` (the database half of
 * `create-app-role.sh`) must never print the SCRAM verifier, even when the
 * DDL fails and Postgres puts the expanded `create role ... password
 * 'SCRAM-SHA-256$...'` statement into the error's `where` field. Runs
 * against an in-memory PGlite (no network, no real database). Run with
 * `node --test site/test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../../src/db/client.js';
import { setAppRolePassword, safeErrorSummary, EXIT_FAILED, EXIT_ROLE_EXISTS } from '../scripts/app-role.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OWNER_URL = 'postgres://owner:owner-secret-token@ep-preview.example.neon.tech/db?sslmode=require';

/** @typedef {import('../../src/db/common.js').Db} Db */

function capture() {
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  return {
    out,
    err,
    stdout: (/** @type {string} */ t) => { out.push(t); },
    stderr: (/** @type {string} */ t) => { err.push(t); },
  };
}

test('a DDL failure (role created by someone else in a race) prints only the code, never the verifier from `where`', async () => {
  const db = createDb({});
  try {
    // Someone else creates `app` after our existence check ...
    await db.transaction(async (tx) => { await tx.exec('create role app login'); }, { actor: 'system' });
    // ... which this wrapper simulates by answering that check with "no rows".
    /** @type {any} */
    let rawError;
    /** @type {Db} */
    const racing = {
      query: async (sql, params) => (/pg_roles/.test(sql) ? { rows: [], rowCount: 0 } : db.query(sql, params)),
      transaction: async (fn, options) => {
        try {
          return await db.transaction(fn, options);
        } catch (err) {
          rawError = err;
          throw err;
        }
      },
      end: async () => {},
    };
    const io = capture();
    const status = await setAppRolePassword({ db: racing, rotate: false, ownerUrl: OWNER_URL, ...io });

    // Not vacuous: the raw error really does carry the verifier.
    assert.ok(rawError, 'the create role statement must have failed');
    assert.equal(rawError.code, '42710', `expected duplicate_object, got ${rawError.code}: ${rawError.message}`);
    assert.match(String(rawError.where), /SCRAM-SHA-256\$/, 'PGlite should report the failing statement in `where`');

    assert.equal(status, EXIT_FAILED);
    const printed = [...io.out, ...io.err].join('\n');
    assert.match(printed, /ROLE_FAILED \(code 42710: /);
    assert.ok(!printed.includes('SCRAM-SHA-256$'), `verifier leaked into output:\n${printed}`);
    assert.ok(!printed.includes('owner-secret-token'));
    assert.deepEqual(io.out, [], 'nothing on stdout when it fails');
  } finally {
    await db.end();
  }
});

test('a stubbed client error with the verifier in message, where and detail is reduced to code + redacted first line', async () => {
  const verifier = 'SCRAM-SHA-256$4096:c2FsdA==$c3RvcmVk:c2VydmVy';
  /** @type {Db} */
  const failing = {
    query: async () => ({ rows: [], rowCount: 0 }),
    transaction: async () => {
      const err = Object.assign(new Error(`syntax error at or near '${verifier}'\nsecond line ${verifier}`), {
        code: '42601',
        where: `SQL statement "create role app login password '${verifier}'"`,
        detail: verifier,
        internalQuery: `create role app login password '${verifier}'`,
      });
      throw err;
    },
    end: async () => {},
  };
  const io = capture();
  const status = await setAppRolePassword({ db: failing, rotate: false, ownerUrl: OWNER_URL, ...io });
  assert.equal(status, EXIT_FAILED);
  const printed = [...io.out, ...io.err].join('\n');
  assert.ok(!printed.includes('SCRAM-SHA-256$4096'), printed);
  assert.doesNotMatch(printed, /second line|SQL statement|create role/);
  assert.match(printed, /code 42601: syntax error at or near 'SCRAM-SHA-256\$<redacted>/);
});

test('safeErrorSummary never reads where/detail and tolerates non-Error values', () => {
  assert.equal(safeErrorSummary({ code: 'X1', message: 'boom', where: 'SCRAM-SHA-256$secret' }), 'code X1: boom');
  assert.equal(safeErrorSummary('plain string'), 'code unknown: plain string');
  assert.equal(safeErrorSummary({ code: 'bad code; rm', message: 'm' }), 'code unknown: m');
});

test('create, then refuse a second create, then rotate: stdout carries only the app-role URL', async () => {
  const db = createDb({});
  try {
    const first = capture();
    assert.equal(await setAppRolePassword({ db, rotate: false, ownerUrl: OWNER_URL, ...first }), 0);
    assert.equal(first.out.length, 1);
    const url = new URL(first.out[0]);
    assert.equal(url.username, 'app');
    assert.equal(url.host, 'ep-preview.example.neon.tech');
    assert.equal(url.searchParams.get('sslmode'), 'require');
    assert.ok(url.password.length >= 40);

    const again = capture();
    assert.equal(await setAppRolePassword({ db, rotate: false, ownerUrl: OWNER_URL, ...again }), EXIT_ROLE_EXISTS);
    assert.deepEqual(again.out, []);

    const rotated = capture();
    assert.equal(await setAppRolePassword({ db, rotate: true, ownerUrl: OWNER_URL, ...rotated }), 0);
    assert.notEqual(new URL(rotated.out[0]).password, url.password);
  } finally {
    await db.end();
  }
});

test('run as a process, any failure exits non-zero with only a code line (no stack, no fields)', () => {
  // No DATABASE_URL: dbOptionsFromEnv picks in-memory PGlite, and the empty
  // owner URL then fails to parse -- before any role is touched.
  let status = 0;
  let output = '';
  try {
    execFileSync(process.execPath, [path.join(REPO_ROOT, 'site/scripts/app-role.mjs')], {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (/** @type {any} */ err) {
    status = err.status ?? 1;
    output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  assert.equal(status, EXIT_FAILED, output);
  assert.match(output, /^ROLE_FAILED \(code ERR_INVALID_URL: Invalid URL\)\n$/);
});
