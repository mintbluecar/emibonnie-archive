// @ts-check
/** Dispatch semantics `test/helpers/miniDom.js`'s callers rely on. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MiniElement } from './miniDom.js';

test('a listener added during dispatch does not run in that dispatch', () => {
  const el = new MiniElement('div');
  /** @type {string[]} */
  const calls = [];
  el.addEventListener('click', () => {
    calls.push('first');
    el.addEventListener('click', () => calls.push('second'));
  });

  el.dispatchEvent({ type: 'click', target: el });
  assert.deepEqual(calls, ['first'], 'the listener added during this dispatch must not run in it');

  el.dispatchEvent({ type: 'click', target: el });
  assert.deepEqual(calls, ['first', 'first', 'second'], 'the next dispatch runs both, in the order they were added');
});
