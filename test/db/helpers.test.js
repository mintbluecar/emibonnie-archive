// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStaleTestName, uniqueName } from '../helpers/db.js';

const NOW = Date.UTC(2026, 9, 21);
const HOUR = 60 * 60 * 1000;

test('the stale sweep only selects names in the generator format, once old enough', () => {
  const old = `fa_test_${NOW - 2 * HOUR}_0123abcd`;
  assert.equal(isStaleTestName(old, 'fa_test', NOW), true);
  assert.equal(isStaleTestName(`fa_test_${NOW - 60_000}_0123abcd`, 'fa_test', NOW), false, 'too recent');
  for (const name of ['fa_test_2024_backup', 'fa_test_x', 'fa_test_', `fa_test_${NOW - 2 * HOUR}_0123abcd_copy`,
    `fa_test_${NOW - 2 * HOUR}_0123ABCD`, `my_fa_test_${NOW - 2 * HOUR}_0123abcd`, `fa_test_app_${NOW - 2 * HOUR}_0123abcd`]) {
    assert.equal(isStaleTestName(name, 'fa_test', NOW), false, name);
  }
  assert.equal(isStaleTestName(`fa_test_app_${NOW - 2 * HOUR}_0123abcd`, 'fa_test_app', NOW), true);
  assert.equal(isStaleTestName(old, 'fa_test_app', NOW), false);
});

test('names from uniqueName match the sweep format', () => {
  const later = Date.now() + 2 * HOUR;
  assert.equal(isStaleTestName(uniqueName('fa_test'), 'fa_test', later), true);
  assert.equal(isStaleTestName(uniqueName('fa_test_app'), 'fa_test_app', later), true);
});
