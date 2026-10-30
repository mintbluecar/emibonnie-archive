// @ts-check
/**
 * The generated password for the `app` database role.
 *
 * Fix round 5 (live failure): this file used to be `scram.mjs`, which also
 * computed a SCRAM-SHA-256 verifier so only that hash reached the server.
 * Neon rejects that: `create role` with a pre-hashed password failed on the
 * real preview branch with "Neon only supports being given plaintext
 * passwords", and Neon's docs say "Passwords must be supplied in plain text
 * but are encrypted when stored. Hashed passwords are not supported."
 * (https://neon.com/docs/manage/roles). So the verifier code is gone, and
 * `app-role.mjs` sends this plaintext password (see its header).
 */
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

/**
 * A strong, URL-safe password: 33 random bytes, base64url, unpadded --
 * 44 characters from [A-Za-z0-9_-], 264 bits of randomness, well above
 * Neon's 60-bit minimum for passwords set through SQL
 * (https://neon.com/docs/manage/roles). URL-safe so it can sit in the
 * app-role connection string unescaped.
 * @returns {string}
 */
export function randomPassword() {
  return randomBytes(33).toString('base64url');
}

/**
 * Splits a connection string into a password-free URL and the password, so
 * `pg_dump`/`psql` can take the URL in argv (visible to `ps`) and the
 * password through `PGPASSWORD`. libpq: "PGPASSWORD behaves the same as the
 * password connection parameter", and a parameter given in the connection
 * string would win over it, so the URL must not carry one
 * (https://www.postgresql.org/docs/current/libpq-envars.html). The password
 * comes back percent-decoded, as libpq would read it from the URL.
 * @param {string} url
 * @returns {{ url: string, password: string }}
 */
export function splitDbUrl(url) {
  const parsed = new URL(url);
  const password = decodeURIComponent(parsed.password);
  parsed.password = '';
  return { url: parsed.toString(), password };
}

// `DATABASE_URL=... node site/scripts/password.mjs url|password` prints one
// half (site/Taskfile.yml's backup and takedown). The URL arrives through
// the environment and the password leaves through stdout: neither is argv.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const part = process.argv[2];
  if ((part !== 'url' && part !== 'password') || !process.env.DATABASE_URL) {
    process.stderr.write('usage: DATABASE_URL=<url> node site/scripts/password.mjs url|password\n');
    process.exitCode = 1;
  } else {
    try {
      process.stdout.write(splitDbUrl(process.env.DATABASE_URL)[part]);
    } catch {
      // Never the error itself: node's ERR_INVALID_URL carries the whole
      // input, password included, in its `input` field.
      process.stderr.write('password.mjs: the connection string is not a valid URL (percent-encode any special characters in the password)\n');
      process.exitCode = 1;
    }
  }
}
