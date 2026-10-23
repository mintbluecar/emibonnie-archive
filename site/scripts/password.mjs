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
