// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withGlobals } from './globals.js';

test('withGlobals restores globals even when fn throws', async () => {
  const PRESENT = '__withGlobalsTestPresent';
  const ABSENT = '__withGlobalsTestAbsent';
  /** @type {any} */ (globalThis)[PRESENT] = 'before';
  delete (/** @type {any} */ (globalThis))[ABSENT];

  await assert.rejects(
    () => withGlobals({ [PRESENT]: 'during', [ABSENT]: 'during' }, async () => {
      assert.equal(/** @type {any} */ (globalThis)[PRESENT], 'during', 'the override is visible inside fn');
      assert.equal(/** @type {any} */ (globalThis)[ABSENT], 'during');
      throw new Error('boom');
    }),
    /boom/,
  );

  assert.equal(/** @type {any} */ (globalThis)[PRESENT], 'before', 'a key that existed is restored to its old value');
  assert.equal(Object.hasOwn(globalThis, ABSENT), false, 'a key that was absent is deleted again');
});
