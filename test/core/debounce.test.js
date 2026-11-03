// @ts-check
/** `debounced(fn, ms)` (public/js/core/debounce.js): the shared pause before a search refetches. */
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { debounced } from '../../public/js/core/debounce.js';

test('calls once, with the value, after the delay', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    /** @type {string[]} */
    const calls = [];
    const run = debounced((value) => calls.push(value), 250);
    run('a');
    mock.timers.tick(249);
    assert.deepEqual(calls, []);
    mock.timers.tick(1);
    assert.deepEqual(calls, ['a']);
  } finally {
    mock.timers.reset();
  }
});

test('a second call inside the delay resets the timer; only the last value runs', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    /** @type {string[]} */
    const calls = [];
    const run = debounced((value) => calls.push(value), 250);
    run('a');
    mock.timers.tick(200);
    run('ab');
    mock.timers.tick(200);
    assert.deepEqual(calls, [], 'the first timer was cleared');
    mock.timers.tick(50);
    assert.deepEqual(calls, ['ab']);
  } finally {
    mock.timers.reset();
  }
});
