// @ts-check
/**
 * Snake_case -> camelCase row mapping, shared by every repo module so SQL
 * stays snake_case (matching the schema) while the objects repos return
 * stay camelCase (Rule 1, Task 8 brief). A column whose camelCase name
 * isn't the field name a caller wants (e.g. `live_platform` ->
 * `livePlatformCode`) is renamed by the repo function itself, after
 * calling this.
 */

/** @param {string} key @returns {string} */
function camelKey(key) {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
export function camelRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [camelKey(key), value]));
}

/**
 * @param {Record<string, unknown>[]} rows
 * @returns {Record<string, unknown>[]}
 */
export function camelRows(rows) {
  return rows.map(camelRow);
}
