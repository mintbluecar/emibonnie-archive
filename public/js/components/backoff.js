// @ts-check
/**
 * The "check for update" button's browser throttle (task-4 brief, owner's
 * ruling 1): after each press the button locks for 1 min, then 5 min,
 * then 15 min, staying at 15 min for every press after that. Pure (no
 * DOM, no localStorage) so it's testable on its own; `refreshButton.js`
 * is the only caller, and owns reading/writing the per-translation state.
 */

const LOCK_MS_BY_PRESS = [60000, 300000, 900000];

/**
 * `pressCount`: the number of presses so far, including the one that
 * just happened (so the 1st press passes `1`).
 * @param {number} pressCount
 * @returns {number}
 */
export function nextLockMs(pressCount) {
  const index = Math.min(pressCount, LOCK_MS_BY_PRESS.length) - 1;
  return LOCK_MS_BY_PRESS[Math.max(index, 0)];
}
