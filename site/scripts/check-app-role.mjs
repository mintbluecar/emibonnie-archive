// @ts-check
/**
 * The database half of `site/scripts/check-app-role.sh`: asks the least-
 * privilege query over DATABASE_URL, prints the answer row as JSON, and
 * fails (`NOT_LEAST_PRIVILEGE: ...` on stderr, exit 1) unless all three
 * columns are `false`. See the shell script's header for why these three.
 *
 * Moved out of an inline `node -e` string so `violations` can be tested
 * directly (site/test/checkAppRole.test.js).
 */
import { pathToFileURL } from 'node:url';

/**
 * @typedef {{ superuser_member?: unknown, can_update_audit?: unknown, can_delete_audit?: unknown }} PrivilegeRow
 */

/**
 * What is wrong with one answer row. Fails closed: a column counts as a
 * violation unless it is exactly `false` (a null or missing column too).
 * @param {PrivilegeRow | undefined} row
 * @returns {string[]} empty when `app` is least-privilege
 */
export function violations(row) {
  if (!row) return ['the least-privilege query returned no row'];
  /** @type {string[]} */
  const bad = [];
  if (row.superuser_member !== false) bad.push('app is a member of neon_superuser');
  if (row.can_update_audit !== false) bad.push('app can UPDATE audit_log');
  if (row.can_delete_audit !== false) bad.push('app can DELETE from audit_log');
  return bad;
}

async function main() {
  const { createDb, dbOptionsFromEnv } = await import('../../src/db/client.js');
  const db = createDb(dbOptionsFromEnv(process.env));
  try {
    const { rows } = await db.query(
      'select pg_has_role($1, $2, $3) as superuser_member, has_table_privilege($1, $4, $5) as can_update_audit, has_table_privilege($1, $4, $6) as can_delete_audit',
      ['app', 'neon_superuser', 'member', 'audit_log', 'update', 'delete'],
    );
    const row = /** @type {PrivilegeRow | undefined} */ (rows[0]);
    console.log(JSON.stringify(row));
    const bad = violations(row);
    if (bad.length > 0) {
      console.error(`NOT_LEAST_PRIVILEGE: ${bad.join('; ')}`);
      process.exitCode = 1;
    }
  } finally {
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
