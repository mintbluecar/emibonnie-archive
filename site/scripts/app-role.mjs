// @ts-check
/**
 * The database half of `site/scripts/create-app-role.sh`: checks whether
 * the `app` role exists, then creates it (or, with ROTATE=1, re-passwords
 * it) from a SCRAM-SHA-256 verifier computed on this machine, and prints
 * the app-role connection string on stdout -- nothing else ever goes to
 * stdout. See the shell script's header comment, and `scram.mjs`, for why
 * the verifier (never the plaintext password) is what reaches Postgres.
 *
 * Moved out of a heredoc inside the shell script in fix round 4 (N1), so
 * its error handling can be tested directly (site/test/appRole.test.js).
 *
 * Fix round 4, N1 -- error redaction. When the DDL fails (say, `app` was
 * created by someone else between the existence check and the `create
 * role`), Postgres reports the failing statement in the error's `where`
 * field (its CONTEXT), and that statement is the expanded `create role
 * app login password 'SCRAM-SHA-256$...'` -- the verifier. node's default
 * handler for an uncaught error prints every field, `where` included. So
 * every error here is caught and reduced to `err.code` plus the first line
 * of its message, with anything shaped like a verifier redacted; `where`,
 * `detail`, `internalQuery` and the stack are never printed.
 *
 * The server log can still record that CONTEXT line when the statement
 * fails (Postgres logs an error's context with it). That's the verifier,
 * not the password, and RFC 5802 is built for exactly that case: "The
 * authentication information stored in the authentication database is not
 * sufficient by itself to impersonate the client" (section 1); recovering
 * the password from it takes "an offline dictionary or brute-force attack"
 * (section 9) -- against a 33-byte random password, not feasible.
 * https://www.rfc-editor.org/rfc/rfc5802
 * We still keep it out of this script's own output, which is the part we
 * control.
 */
import { pathToFileURL } from 'node:url';
import { scramSha256Verifier, randomPassword } from './scram.mjs';

export const EXIT_FAILED = 1;
export const EXIT_ROLE_EXISTS = 2;
export const EXIT_ROLE_MISSING = 3;

/**
 * A one-line, secret-free description of an error: its `code` (a Postgres
 * SQLSTATE, or a node error code) and the first line of its message, with
 * anything shaped like a SCRAM verifier redacted. Never reads `where`,
 * `detail`, `internalQuery` or `stack`.
 * @param {unknown} err
 * @returns {string}
 */
export function safeErrorSummary(err) {
  const e = /** @type {{ code?: unknown, message?: unknown }} */ (err ?? {});
  const code = typeof e.code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(e.code) ? e.code : 'unknown';
  const firstLine = (typeof e.message === 'string' ? e.message : String(err)).split('\n')[0] ?? '';
  const message = firstLine
    .replace(/SCRAM-SHA-256\$\S*/g, 'SCRAM-SHA-256$<redacted>')
    .slice(0, 200);
  return `code ${code}: ${message}`;
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
    const password = randomPassword();
    const verifier = scramSha256Verifier(password);
    const stmt = rotate ? 'alter role app password %L' : 'create role app login password %L';
    await db.transaction(async (tx) => {
      await tx.query("select set_config('app.pw', $1, true)", [verifier]);
      await tx.exec(`do $$ begin execute format('${stmt}', current_setting('app.pw')); end $$;`);
    }, { actor: 'system' });
    url.username = 'app';
    url.password = password;
    stderr(rotate ? 'ROLE_ROTATED' : 'ROLE_CREATED');
    stdout(url.toString());
    return 0;
  } catch (err) {
    stderr(`ROLE_FAILED (${safeErrorSummary(err)})`);
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
