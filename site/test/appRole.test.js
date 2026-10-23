// @ts-check
/**
 * `site/scripts/app-role.mjs` (the database half of `create-app-role.sh`)
 * sends Neon the plaintext password (fix round 5: Neon refuses hashed
 * ones), and must never print it -- even when the DDL fails and Postgres
 * puts the expanded `create role ... password '<plaintext>'` statement into
 * the error's `where` field. Runs against an in-memory PGlite (no network,
 * no real database). Run with `node --test site/test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../../src/db/client.js';
import { setAppRolePassword, safeErrorSummary, EXIT_FAILED, EXIT_ROLE_EXISTS, EXIT_ROLE_MISSING } from '../scripts/app-role.mjs';

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

test('a DDL failure (role created by someone else in a race) prints only the code, never the plaintext from `where`', async () => {
  const db = createDb({});
  try {
    // Someone else creates `app` after our existence check ...
    await db.transaction(async (tx) => { await tx.exec('create role app login'); }, { actor: 'system' });
    // ... which this wrapper simulates by answering that check with "no rows".
    /** @type {any} */
    let rawError;
    /** @type {string | undefined} */
    let sentPassword;
    /** @type {Db} */
    const racing = {
      query: async (sql, params) => (/pg_roles/.test(sql) ? { rows: [], rowCount: 0 } : db.query(sql, params)),
      transaction: async (fn, options) => {
        try {
          return await db.transaction(async (tx) => fn({
            ...tx,
            query: async (sql, params) => {
              if (/set_config\('app\.pw'/.test(sql)) sentPassword = /** @type {string} */ (params?.[0]);
              return tx.query(sql, params);
            },
          }), options);
        } catch (err) {
          rawError = err;
          throw err;
        }
      },
      end: async () => {},
    };
    const io = capture();
    const status = await setAppRolePassword({ db: racing, rotate: false, ownerUrl: OWNER_URL, ...io });

    // Not vacuous: the plaintext was sent, and the raw error really does carry it.
    assert.ok(rawError, 'the create role statement must have failed');
    assert.equal(rawError.code, '42710', `expected duplicate_object, got ${rawError.code}: ${rawError.message}`);
    assert.ok(sentPassword && /^[A-Za-z0-9_-]{44}$/.test(sentPassword), 'the plaintext password is the bind parameter');
    assert.ok(String(rawError.where).includes(sentPassword), 'PGlite should report the failing statement, password included, in `where`');

    assert.equal(status, EXIT_FAILED);
    const printed = [...io.out, ...io.err].join('\n');
    assert.match(printed, /ROLE_FAILED \(code 42710: /);
    assert.ok(!printed.includes(sentPassword), `password leaked into output:\n${printed}`);
    assert.ok(!printed.includes('owner-secret-token'));
    assert.deepEqual(io.out, [], 'nothing on stdout when it fails');
  } finally {
    await db.end();
  }
});

/**
 * A client whose transaction captures the plaintext password from the
 * set_config bind parameter, then throws `makeError(password)`.
 * @param {(password: string) => Error} makeError
 * @returns {{ db: Db, sent: () => string }}
 */
function failingWith(makeError) {
  let sent = '';
  /** @type {Db} */
  const db = {
    query: async () => ({ rows: [], rowCount: 0 }),
    transaction: async (fn) => {
      /** @type {any} */
      const tx = {
        query: async (/** @type {string} */ _sql, /** @type {unknown[]} */ params) => {
          sent = String(params[0]);
          return { rows: [], rowCount: 0 };
        },
        exec: async () => { throw makeError(sent); },
      };
      return fn(tx);
    },
    end: async () => {},
  };
  return { db, sent: () => sent };
}

test('a stubbed client error with the password in message, where, detail and internalQuery prints none of it', async () => {
  const { db, sent } = failingWith((pw) => Object.assign(
    new Error(`syntax error at or near '${pw}' (password ${pw})\nsecond line ${pw}`),
    {
      code: '42601',
      where: `SQL statement "create role app login password '${pw}'"`,
      detail: pw,
      internalQuery: `create role app login password '${pw}'`,
    },
  ));
  const io = capture();
  const status = await setAppRolePassword({ db, rotate: false, ownerUrl: OWNER_URL, ...io });
  assert.equal(status, EXIT_FAILED);
  assert.equal(sent().length, 44, 'the stub must have seen the real password');
  const printed = [...io.out, ...io.err].join('\n');
  assert.ok(!printed.includes(sent()), printed);
  assert.doesNotMatch(printed, /second line|SQL statement|create role/);
  assert.match(printed, /^ROLE_FAILED \(code 42601: syntax error at or near '<redacted>' \(password <redacted>\)\)$/);
});

test('the live Neon control-plane rejection keeps its useful message and carries no password', async () => {
  // The shape the owner hit on the real preview branch (fix round 5), with
  // the failing statement -- password and all -- in `where`, as Postgres
  // reports a DO block's CONTEXT.
  const { db, sent } = failingWith((pw) => Object.assign(
    new Error('Received HTTP code 400 from control plane: {"request_id":"0000-test","error":"Neon only supports being given plaintext passwords"}'),
    {
      code: 'XX000',
      where: `SQL statement "alter role app password '${pw}'"\nPL/pgSQL function inline_code_block line 1 at EXECUTE`,
    },
  ));
  const io = capture();
  const status = await setAppRolePassword({ db, rotate: false, ownerUrl: OWNER_URL, ...io });
  assert.equal(status, EXIT_FAILED);
  const printed = [...io.out, ...io.err].join('\n');
  assert.equal(
    printed,
    'ROLE_FAILED (code XX000: Received HTTP code 400 from control plane: {"request_id":"0000-test","error":"Neon only supports being given plaintext passwords"})',
  );
  assert.ok(!printed.includes(sent()));
});

test('safeErrorSummary never reads where/detail, redacts the given secret and password literals, and tolerates non-Error values', () => {
  assert.equal(safeErrorSummary({ code: 'X1', message: 'boom', where: "password 'hunter2'" }), 'code X1: boom');
  assert.equal(safeErrorSummary('plain string'), 'code unknown: plain string');
  assert.equal(safeErrorSummary({ code: 'bad code; rm', message: 'm' }), 'code unknown: m');
  assert.equal(safeErrorSummary({ code: 'X2', message: 'near s3cr3t-value here' }, 's3cr3t-value'), 'code X2: near <redacted> here');
  assert.equal(
    safeErrorSummary({ code: 'X3', message: "bad: create role app login PASSWORD 'it''s secret' now" }),
    "code X3: bad: create role app login password '<redacted>' now",
  );
  // A secret split across the first newline is still redacted.
  assert.equal(safeErrorSummary({ code: 'X4', message: 'a\nb' }, 'a\nb'), 'code X4: <redacted>');
});

test('create, then refuse a second create, then rotate: the role really gets the password, and stdout carries only the app-role URL', async () => {
  const db = createDb({});
  /** @param {string} pw */
  const storedMatches = async (pw) => {
    // PGlite runs as a superuser, so pg_authid is readable. The stored value
    // is Postgres's own SCRAM-SHA-256 hash of the plaintext we sent
    // (password_encryption = scram-sha-256), never the plaintext itself.
    const { rows } = await db.query("select rolpassword from pg_authid where rolname = 'app'");
    assert.equal(rows.length, 1, 'pg_authid must be readable in PGlite');
    const stored = String(/** @type {any} */ (rows[0]).rolpassword);
    assert.match(stored, /^SCRAM-SHA-256\$/);
    assert.ok(!stored.includes(pw), 'stored hashed, not as plaintext');
    return stored;
  };
  try {
    const first = capture();
    assert.equal(await setAppRolePassword({ db, rotate: false, ownerUrl: OWNER_URL, ...first }), 0);
    assert.deepEqual(first.err, ['ROLE_CREATED']);
    assert.equal(first.out.length, 1);
    const url = new URL(first.out[0]);
    assert.equal(url.username, 'app');
    assert.equal(url.host, 'ep-preview.example.neon.tech');
    assert.equal(url.searchParams.get('sslmode'), 'require');
    assert.equal(url.password.length, 44);
    const roles = await db.query("select rolcanlogin, rolsuper from pg_roles where rolname = 'app'");
    assert.deepEqual(roles.rows, [{ rolcanlogin: true, rolsuper: false }]);
    const firstHash = await storedMatches(url.password);

    const again = capture();
    assert.equal(await setAppRolePassword({ db, rotate: false, ownerUrl: OWNER_URL, ...again }), EXIT_ROLE_EXISTS);
    assert.deepEqual(again.out, []);

    const rotated = capture();
    assert.equal(await setAppRolePassword({ db, rotate: true, ownerUrl: OWNER_URL, ...rotated }), 0);
    assert.deepEqual(rotated.err, ['ROLE_ROTATED']);
    const newPassword = new URL(rotated.out[0]).password;
    assert.notEqual(newPassword, url.password);
    assert.notEqual(await storedMatches(newPassword), firstHash, 'rotation must change the stored password');
  } finally {
    await db.end();
  }
});

test('rotate refuses when the role does not exist yet', async () => {
  const db = createDb({});
  try {
    const io = capture();
    assert.equal(await setAppRolePassword({ db, rotate: true, ownerUrl: OWNER_URL, ...io }), EXIT_ROLE_MISSING);
    assert.deepEqual(io.out, []);
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
