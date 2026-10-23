// @ts-check
/**
 * A SCRAM-SHA-256 password *verifier*, computed entirely on this machine,
 * in the exact text Postgres stores in `pg_authid.rolpassword` -- so a
 * role's password can be set without the plaintext ever being sent to, or
 * logged by, the server (fix round 3, C1).
 *
 * `create role ... password $1` (a bind parameter) is not valid SQL:
 * Postgres only accepts bind parameters inside SELECT/INSERT/UPDATE/
 * DELETE/MERGE/VALUES (the "Parameters" note on
 * https://www.postgresql.org/docs/current/sql-prepare.html), never inside
 * a DDL statement like CREATE ROLE. `site/scripts/create-app-role.sh`
 * instead computes this verifier here, passes *that* (not the plaintext)
 * as a bind parameter to a plain `select set_config(...)`, and only then
 * splices it into `create role ... password %L` with `format()`, inside
 * one transaction -- so the one untrusted-shaped value that ever reaches
 * `format()` is a value *this module* produced, already constrained to
 * the exact character set `scramSha256Verifier` below emits.
 *
 * Postgres's own on-disk format for a SCRAM-SHA-256 password (text from
 * https://www.postgresql.org/docs/current/auth-password.html, "Password
 * Authentication"): `SCRAM-SHA-256$<iteration count>:<salt>$<StoredKey>:
 * <ServerKey>`, with the salt, StoredKey and ServerKey base64-encoded.
 * Postgres recognises a value already in this shape and stores it as
 * given, rather than re-hashing it as a new plaintext password -- the
 * same mechanism `pg_dump`/`pg_restore` rely on to carry a password hash
 * across a dump without ever seeing the plaintext. Confirmed directly
 * against PGlite (`@electric-sql/pglite`, already a dev dependency):
 * `create role x login password '<a verifier this module produced>'`
 * stores `pg_authid.rolpassword` as *exactly* that string, byte for byte
 * (site/test/scram.test.js).
 *
 * The key derivation itself follows RFC 5802 ("Salted Challenge Response
 * Authentication Mechanism (SCRAM)") section 3, with SHA-256 throughout,
 * per RFC 7677 ("SCRAM-SHA-256 and SCRAM-SHA-256-PLUS SASL Mechanisms")
 * section 3:
 *   SaltedPassword = PBKDF2-HMAC-SHA256(password, salt, iterations, 32)
 *   ClientKey      = HMAC(SaltedPassword, "Client Key")
 *   StoredKey      = SHA256(ClientKey)
 *   ServerKey      = HMAC(SaltedPassword, "Server Key")
 * `site/test/scram.test.js` checks this derivation against RFC 7677
 * section 3's own worked example (reconstructing its AuthMessage from the
 * four messages the RFC prints, and matching the RFC's own ClientProof
 * and ServerSignature) -- the RFC's example doesn't print StoredKey or
 * ServerKey directly, but ClientProof and ServerSignature are each
 * deterministic functions of them plus that AuthMessage, so matching both
 * confirms this derivation against the RFC's own numbers, not just
 * against Postgres.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

const DIGEST = 'sha256';
const KEY_LENGTH = 32; // the SHA-256 digest size, in bytes
const DEFAULT_ITERATIONS = 4096; // RFC 7677 section 3's own example uses the same count

/**
 * @param {Buffer} key
 * @param {string} data
 * @returns {Buffer}
 */
function hmac(key, data) {
  return createHmac(DIGEST, key).update(data, 'utf8').digest();
}

/** @param {Buffer} data @returns {Buffer} */
function hash(data) {
  return createHash(DIGEST).update(data).digest();
}

/**
 * RFC 5802 section 3's SaltedPassword/ClientKey/StoredKey/ServerKey, with
 * SHA-256 (RFC 7677 section 3). Exported separately from
 * `scramSha256Verifier` so a test can check it against RFC 7677's own
 * worked example without re-deriving the formatted verifier string.
 * @param {string} password
 * @param {Buffer} salt
 * @param {number} iterations
 * @returns {{ clientKey: Buffer, storedKey: Buffer, serverKey: Buffer }}
 */
export function deriveKeys(password, salt, iterations) {
  const saltedPassword = pbkdf2Sync(password, salt, iterations, KEY_LENGTH, DIGEST);
  const clientKey = hmac(saltedPassword, 'Client Key');
  const storedKey = hash(clientKey);
  const serverKey = hmac(saltedPassword, 'Server Key');
  return { clientKey, storedKey, serverKey };
}

/**
 * The exact text to give Postgres as a role's password, so the plaintext
 * itself never has to be: `create role ... password <this>` (quoted with
 * `format('%L', ...)`, never string-concatenated) stores it verbatim,
 * rather than hashing it again.
 * @param {string} password
 * @param {{ salt?: Buffer, iterations?: number }} [options] Fixed only by
 *   tests; a real call always takes the random default.
 * @returns {string}
 */
export function scramSha256Verifier(password, options = {}) {
  const salt = options.salt ?? randomBytes(16);
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const { storedKey, serverKey } = deriveKeys(password, salt, iterations);
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/** Matches exactly the format `scramSha256Verifier` produces. */
export const VERIFIER_PATTERN = /^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/;

/**
 * A strong, URL-safe password for the role itself (never embedded in any
 * URL by this module -- `create-app-role.sh` does that -- but kept
 * URL-safe so it is, downstream). 33 random bytes, base64url, unpadded:
 * the same shape `openssl rand -base64 33 | tr '+/' '-_' | tr -d '='`
 * produced in earlier rounds, now generated without depending on the
 * `openssl` binary being on PATH.
 * @returns {string}
 */
export function randomPassword() {
  return randomBytes(33).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
