// @ts-check
/**
 * `nextLockMs` is pure (no DOM, no localStorage), per the task-4 brief's
 * ruling 1: "Put the pure function in its own small module so it can be
 * tested without the DOM." `pressCount` is the number of presses so far,
 * including the one that just happened.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextLockMs } from '../../public/js/components/backoff.js';

test('nextLockMs: 1 min after the 1st press, 5 min after the 2nd, 15 min after the 3rd', () => {
  assert.equal(nextLockMs(1), 60000);
  assert.equal(nextLockMs(2), 300000);
  assert.equal(nextLockMs(3), 900000);
});

test('nextLockMs: stays at 15 min for every press from the 3rd on', () => {
  assert.equal(nextLockMs(4), 900000);
  assert.equal(nextLockMs(10), 900000);
});
