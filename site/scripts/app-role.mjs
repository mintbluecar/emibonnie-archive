// @ts-check
/**
 * The database half of `site/scripts/create-app-role.sh`: checks whether
 * the `app` role exists, then creates it (or, with ROTATE=1, re-passwords
 * it) with a freshly generated password, and prints the app-role
 * connection string on stdout -- nothing else ever goes to stdout.
 *
 * Moved out of a heredoc inside the shell script in fix round 4 (N1), so
 * its error handling can be tested directly (site/test/appRole.test.js).
 *
 * Fix round 5 (live failure): the password goes to Neon in plaintext.
 * Rounds 3-4 sent a SCRAM-SHA-256 verifier instead, and the real preview
 * branch refused it: "Neon only supports being given plaintext passwords".
 * Neon's docs: "Passwords must be supplied in plain text but are encrypted
 * when stored. Hashed passwords are not supported."
 * (https://neon.com/docs/manage/roles). The role is still created with SQL,
 * never the Neon console/API, because the same page says SQL-created roles
 * "are not granted membership in the neon_superuser role like roles created
 * with the Neon Console, CLI, or API."
 *
 * Where the plaintext goes, plainly:
 *   - Over TLS to Neon: the Neon serverless driver connects over a secure
 *     WebSocket by default, and Neon connection strings carry
 *     `sslmode=require`. Neon stores it encrypted (and Postgres's
 *     `password_encryption`, scram-sha-256, hashes a plaintext password on
 *     storage).
 *   - Into the server's error log, if the statement fails: Postgres logs a
 *     failed statement's CONTEXT, which is the expanded `create role app
 *     login password '<plaintext>'`.
 *   - Never printed locally, never in argv (it's a bind parameter, then a
 *     server-side setting), and never on disk except the chmod-600
 *     fallback file create-app-role.sh writes the connection string to.
 *
 * Quoting stays server-side: the password is a bind parameter to a plain
 * `select set_config('app.pw', $1, true)`, and only then spliced into
 * `create/alter role ... password %L` with `format()`, in one transaction.
 *
 * Error redaction (fix round 4, N1; widened in round 5). A failed DDL puts
 * the expanded statement -- now the plaintext password -- in the error's
 * `where` field, and node's default handler for an uncaught error prints
 * every field. So every error here is caught and reduced to `err.code`
 * plus the first line of its message, with the password itself and any
 * `password '...'` text redacted; `where`, `detail`, `internalQuery` and
 * the stack are never read.
 */
import { pathToFileURL } from 'node:url';
import { randomPassword } from './password.mjs';

export const EXIT_FAILED = 1;
export const EXIT_ROLE_EXISTS = 2;
export const EXIT_ROLE_MISSING = 3;

/**
 * A one-line, secret-free description of an error: its `code` (a Postgres
 * SQLSTATE, or a node error code) and the first line of its message, with
 * `secret` (the generated password, when there is one) replaced wherever
 * it appears, and any `password '...'` text redacted too. Never reads
 * `where`, `detail`, `internalQuery` or `stack`.
 * @param {unknown} err
 * @param {string} [secret]
 * @returns {string}
 */
export function safeErrorSummary(err, secret) {
  const e = /** @type {{ code?: unknown, message?: unknown }} */ (err ?? {});
  const code = typeof e.code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(e.code) ? e.code : 'unknown';
  let text = typeof e.message === 'string' ? e.message : String(err);
  // Redact before cutting to the first line, so a secret can't straddle the cut.
  if (secret) text = text.split(secret).join('<redacted>');
  text = text.replace(/password\s+E?'(?:[^']|'')*'?/gi, "password '<redacted>'");
  const firstLine = text.split('\n')[0] ?? '';
  return `code ${code}: ${firstLine.slice(0, 200)}`;
}

/**
 * @param {{
 *   db: import('../../src/db/common.js').Db,
 *   rotate: boolean,
 *   ownerUrl: string,
 *   stdout: (text: string) => void,
 *   stderr: (text: string) => void,
 * }} options
 * @returns {Promise<number>} the process exit code
 */
export async function setAppRolePassword({ db, rotate, ownerUrl, stdout, stderr }) {
  /** @type {string | undefined} */
  let password;
  try {
    // Parse the owner URL before changing anything, so a malformed one
    // can't leave the role re-passworded with no connection string to show for it.
    const url = new URL(ownerUrl);
    const existing = await db.query('select 1 from pg_roles where rolname = $1', ['app']);
    const exists = existing.rows.length > 0;
    if (rotate && !exists) {
      stderr('ROLE_MISSING');
      return EXIT_ROLE_MISSING;
    }
    if (!rotate && exists) {
      stderr('ROLE_EXISTS');
      return EXIT_ROLE_EXISTS;
    }
    password = randomPassword();
    const stmt = rotate ? 'alter role app password %L' : 'create role app login password %L';
    await db.transaction(async (tx) => {
      await tx.query("select set_config('app.pw', $1, true)", [password]);
      await tx.exec(`do $$ begin execute format('${stmt}', current_setting('app.pw')); end $$;`);
    }, { actor: 'system' });
    url.username = 'app';
    url.password = password;
    stderr(rotate ? 'ROLE_ROTATED' : 'ROLE_CREATED');
    stdout(url.toString());
    return 0;
  } catch (err) {
    stderr(`ROLE_FAILED (${safeErrorSummary(err, password)})`);
    return EXIT_FAILED;
  }
}

async function main() {
  /** @param {string} text */
  const stderr = (text) => { process.stderr.write(`${text}\n`); };
  /** @type {import('../../src/db/common.js').Db | undefined} */
  let db;
  try {
    const { createDb, dbOptionsFromEnv } = await import('../../src/db/client.js');
    db = createDb(dbOptionsFromEnv(process.env));
    process.exitCode = await setAppRolePassword({
      db,
      rotate: process.env.ROTATE === '1',
      ownerUrl: process.env.DATABASE_URL ?? '',
      stdout: (text) => { process.stdout.write(text); },
      stderr,
    });
  } catch (err) {
    stderr(`ROLE_FAILED (${safeErrorSummary(err)})`);
    process.exitCode = EXIT_FAILED;
  } finally {
    try {
      await db?.end();
    } catch (err) {
      stderr(`could not close the database connection (${safeErrorSummary(err)})`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
