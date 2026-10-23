// @ts-check
/**
 * Fix round 3, C1: checks `site/scripts/scram.mjs`'s key derivation
 * against RFC 7677 ("SCRAM-SHA-256 and SCRAM-SHA-256-PLUS SASL
 * Mechanisms") section 3's own worked example, and checks the formatted
 * verifier string against PGlite (a real, local Postgres -- no network,
 * no real database). Run with `node --test site/test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';
import { deriveKeys, scramSha256Verifier, VERIFIER_PATTERN, randomPassword } from '../scripts/scram.mjs';

/**
 * RFC 7677 section 3's own example: username "user", password "pencil",
 * salt `W22ZaJ0SNY7soEsUEjb6gQ==`, iteration count 4096. The RFC prints
 * the four SCRAM messages, not StoredKey/ServerKey directly, so this
 * reconstructs the AuthMessage from exactly those four message strings
 * (RFC 5802 section 3's "AuthMessage" definition) and checks the RFC's
 * own ClientProof and ServerSignature -- each a deterministic function of
 * StoredKey or ServerKey plus that AuthMessage -- against values this
 * module's `deriveKeys` produces for the same password, salt and
 * iteration count. Matching both confirms the derivation against the
 * RFC's own published numbers, independently of Postgres or PGlite.
 */
const RFC7677_EXAMPLE = {
  password: 'pencil',
  salt: Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64'),
  iterations: 4096,
  clientFirstMessageBare: 'n=user,r=rOprNGfwEbeRWgbNEkqO',
  serverFirstMessage: 'r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096',
  clientFinalMessageWithoutProof: 'c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0',
  expectedClientProof: 'dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=',
  expectedServerSignature: '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=',
};

/** @param {Buffer} key @param {string} data @returns {Buffer} */
const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest();

/** @param {Buffer} a @param {Buffer} b @returns {Buffer} */
function xor(a, b) {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] ^ b[i];
  return out;
}

test('deriveKeys matches RFC 7677 section 3\'s own worked example (via ClientProof and ServerSignature)', () => {
  const v = RFC7677_EXAMPLE;
  const { clientKey, storedKey, serverKey } = deriveKeys(v.password, v.salt, v.iterations);
  const authMessage = [v.clientFirstMessageBare, v.serverFirstMessage, v.clientFinalMessageWithoutProof].join(',');

  const clientSignature = hmac(storedKey, authMessage);
  const clientProof = xor(clientKey, clientSignature);
  assert.equal(clientProof.toString('base64'), v.expectedClientProof);

  const serverSignature = hmac(serverKey, authMessage);
  assert.equal(serverSignature.toString('base64'), v.expectedServerSignature);
});

test('scramSha256Verifier formats exactly as Postgres documents (auth-password.html)', () => {
  const salt = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
  const verifier = scramSha256Verifier('pencil', { salt, iterations: 4096 });
  assert.match(verifier, VERIFIER_PATTERN);
  const [scheme, rest] = verifier.split('$4096:');
  assert.equal(scheme, 'SCRAM-SHA-256');
  const [saltPart, keysPart] = rest.split('$');
  assert.equal(saltPart, salt.toString('base64'));
  const [storedKeyB64, serverKeyB64] = keysPart.split(':');
  const { storedKey, serverKey } = deriveKeys('pencil', salt, 4096);
  assert.equal(storedKeyB64, storedKey.toString('base64'));
  assert.equal(serverKeyB64, serverKey.toString('base64'));
});

test('scramSha256Verifier defaults to a random 16-byte salt and 4096 iterations, every call different', () => {
  const a = scramSha256Verifier('some password');
  const b = scramSha256Verifier('some password');
  assert.match(a, VERIFIER_PATTERN);
  assert.match(a, /^SCRAM-SHA-256\$4096:/);
  assert.notEqual(a, b, 'a fresh random salt must make two verifiers of the same password differ');
});

test('randomPassword is URL-safe (no +, /, or = ) and reasonably long', () => {
  for (let i = 0; i < 20; i += 1) {
    const pw = randomPassword();
    assert.doesNotMatch(pw, /[+/=]/);
    assert.ok(pw.length >= 40, `expected a long password, got ${pw.length} characters`);
  }
});

test('pg_authid is readable in PGlite, so the round-trip checks below can never pass vacuously (fix round 4, R4)', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  try {
    await pg.waitReady;
    const { rows } = await pg.query("select rolname, rolpassword from pg_authid where rolname = current_user");
    assert.equal(rows.length, 1, 'expected to read the current role from pg_authid');
  } finally {
    await pg.close();
  }
});

test('PGlite stores a pre-computed SCRAM-SHA-256 verifier verbatim, inside one transaction (fix round 3, C1)', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  try {
    await pg.waitReady;
    const verifier = scramSha256Verifier('a strong generated password, never sent as SQL text');

    await pg.transaction(async (tx) => {
      await tx.query("select set_config('app.pw', $1, true)", [verifier]);
      await tx.exec("do $$ begin execute format('create role scram_test_role login password %L', current_setting('app.pw')); end $$;");
    });

    const roles = await pg.query("select rolname from pg_roles where rolname = 'scram_test_role'");
    assert.equal(roles.rows.length, 1, 'the role must exist');

    // Fix round 4, R4: no fallback. PGlite runs as a superuser, so
    // pg_authid (superuser-only on a real server) must be readable here;
    // if a future PGlite ever restricts it, this test has to fail loudly
    // rather than pass on the role's existence alone, which would prove
    // nothing about the verifier being stored verbatim.
    const authid = await pg.query("select rolpassword from pg_authid where rolname = 'scram_test_role'");
    assert.equal(authid.rows.length, 1, 'pg_authid must be readable in PGlite');
    const stored = /** @type {string} */ (authid.rows[0].rolpassword);
    assert.ok(stored.startsWith('SCRAM-SHA-256$'), `expected a SCRAM-SHA-256 verifier, got: ${stored}`);
    // Stored verbatim, not re-hashed as a new plaintext password: proves
    // Postgres recognised the already-correct shape and kept it as-is.
    assert.equal(stored, verifier);
  } finally {
    await pg.close();
  }
});

test('alter role ... password %L (the --rotate path) replaces the verifier the same way', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  try {
    await pg.waitReady;
    const first = scramSha256Verifier('first generated password');
    const second = scramSha256Verifier('second generated password, after rotation');

    await pg.transaction(async (tx) => {
      await tx.query("select set_config('app.pw', $1, true)", [first]);
      await tx.exec("do $$ begin execute format('create role scram_rotate_role login password %L', current_setting('app.pw')); end $$;");
    });
    await pg.transaction(async (tx) => {
      await tx.query("select set_config('app.pw', $1, true)", [second]);
      await tx.exec("do $$ begin execute format('alter role scram_rotate_role password %L', current_setting('app.pw')); end $$;");
    });

    // No fallback (fix round 4, R4): see the test above.
    const authid = await pg.query("select rolpassword from pg_authid where rolname = 'scram_rotate_role'");
    assert.equal(authid.rows.length, 1, 'pg_authid must be readable in PGlite');
    assert.equal(authid.rows[0].rolpassword, second);
  } finally {
    await pg.close();
  }
});
