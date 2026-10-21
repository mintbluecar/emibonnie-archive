// @ts-check
/**
 * visibility: the SQL fragments every "what can a visitor see" query
 * builds on. An item is visible when it is published, not soft-deleted,
 * its credited account hasn't opted out, and whoever submitted it isn't
 * blocked. An event is visible when it isn't soft-deleted and has at
 * least one visible item.
 *
 * Both builders take a fixed, code-chosen alias (never user input) and
 * return a plain SQL condition string with no values interpolated into
 * it -- every value this file touches (opted_out_at, blocked_at,
 * deleted_at, review_state) is read, never written, by the fragment
 * itself.
 */

const ALIAS = /^[a-z_]+$/;

/** @param {string} alias */
function assertAlias(alias) {
  if (!ALIAS.test(alias)) throw new Error(`visibility: invalid alias '${alias}'`);
}

/**
 * @param {string} [alias]
 * @returns {string}
 */
export function visibleItem(alias = 'i') {
  assertAlias(alias);
  return `${alias}.deleted_at is null and ${alias}.review_state = 'published'
    and not exists (select 1 from accounts a where a.id = ${alias}.credited_account_id and a.opted_out_at is not null)
    and not exists (select 1 from users u where u.id = ${alias}.created_by and u.blocked_at is not null)`;
}

/**
 * @param {string} [alias]
 * @returns {string}
 */
export function visibleEvent(alias = 'e') {
  assertAlias(alias);
  return `${alias}.deleted_at is null and exists (select 1 from items i where i.event_id = ${alias}.id and ${visibleItem('i')})`;
}
