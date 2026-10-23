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

/** Prefix reserved for this file's own inner aliases (never a caller's). */
const RESERVED_PREFIX = 'vis_';

/**
 * A caller-chosen alias must be a plain lower-case identifier, and may
 * never collide with an inner alias this file uses for its own nested
 * subqueries (`vis_acct`, `vis_user`, `vis_item`) -- otherwise, e.g.
 * `visibleItem('u')` would turn the blocked-submitter check into a
 * comparison against `users` itself.
 * @param {string} alias
 */
function assertAlias(alias) {
  if (!ALIAS.test(alias)) throw new Error(`visibility: invalid alias '${alias}'`);
  if (alias.startsWith(RESERVED_PREFIX)) {
    throw new Error(`visibility: invalid alias '${alias}' (the '${RESERVED_PREFIX}' prefix is reserved for this file's own aliases)`);
  }
}

/**
 * Builds the condition for an already-validated alias. Never exported
 * directly: callers go through `visibleItem`, which validates first;
 * this file's own nested calls (from `visibleEvent`) pass one of the
 * reserved `vis_*` aliases, which `assertAlias` would otherwise refuse.
 * @param {string} alias
 * @returns {string}
 */
function itemCondition(alias) {
  return `${alias}.deleted_at is null and ${alias}.review_state = 'published'
    and not exists (select 1 from accounts vis_acct where vis_acct.id = ${alias}.credited_account_id and vis_acct.opted_out_at is not null)
    and not exists (select 1 from users vis_user where vis_user.id = ${alias}.created_by and vis_user.blocked_at is not null)`;
}

/**
 * @param {string} [alias]
 * @returns {string}
 */
export function visibleItem(alias = 'i') {
  assertAlias(alias);
  return itemCondition(alias);
}

/**
 * @param {string} [alias]
 * @returns {string}
 */
export function visibleEvent(alias = 'e') {
  assertAlias(alias);
  return `${alias}.deleted_at is null and exists (select 1 from items vis_item where vis_item.event_id = ${alias}.id and ${itemCondition('vis_item')})`;
}
