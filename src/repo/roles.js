// @ts-check
/**
 * roles: grants the app's runtime database role its privileges, via the
 * `grant_app_role` function defined in `src/db/migrations/001_initial.sql`
 * (read/write on every table in this schema except `audit_log` and
 * `schema_migrations`). Run once after each migrate.
 */

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */

/** @param {Tx} tx @param {string} role @returns {Promise<void>} */
export async function grantAppRole(tx, role) {
  await tx.query('select grant_app_role($1::regrole)', [role]);
}
