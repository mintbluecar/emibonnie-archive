// @ts-check
/**
 * `site/scripts/check-app-role.mjs`: which answers to the least-privilege
 * query fail the check. It fails unless all three columns are exactly
 * `false` (site/scripts/check-app-role.sh's header). Run with
 * `node --test site/test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { violations } from '../scripts/check-app-role.mjs';

const OK = { superuser_member: false, can_update_audit: false, can_delete_audit: false };

for (const [label, row, expected] of /** @type {[string, any, string[]][]} */ ([
  ['all three false', OK, []],
  ['a neon_superuser member', { ...OK, superuser_member: true }, ['app is a member of neon_superuser']],
  ['UPDATE on audit_log', { ...OK, can_update_audit: true }, ['app can UPDATE audit_log']],
  ['DELETE on audit_log', { ...OK, can_delete_audit: true }, ['app can DELETE from audit_log']],
  ['everything wrong', { superuser_member: true, can_update_audit: true, can_delete_audit: true },
    ['app is a member of neon_superuser', 'app can UPDATE audit_log', 'app can DELETE from audit_log']],
  ['a null column (fails closed)', { ...OK, can_delete_audit: null }, ['app can DELETE from audit_log']],
  ['a missing column (fails closed)', { superuser_member: false, can_update_audit: false }, ['app can DELETE from audit_log']],
  ['no row at all', undefined, ['the least-privilege query returned no row']],
])) {
  test(`violations: ${label}`, () => {
    assert.deepEqual(violations(row), expected);
  });
}
