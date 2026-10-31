// @ts-check
/**
 * Sets `globalThis[key]` for each of `overrides`, runs `fn`, and restores
 * the previous values in `finally` -- even if `fn` throws -- deleting any
 * key that was absent beforehand rather than leaving it `undefined`.
 */

/**
 * @template T
 * @param {Record<string, unknown>} overrides
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withGlobals(overrides, fn) {
  const saved = Object.keys(overrides).map((key) => ({
    key,
    had: Object.hasOwn(globalThis, key),
    value: /** @type {any} */ (globalThis)[key],
  }));
  for (const key of Object.keys(overrides)) /** @type {any} */ (globalThis)[key] = overrides[key];
  try {
    return await fn();
  } finally {
    for (const { key, had, value } of saved) {
      if (had) /** @type {any} */ (globalThis)[key] = value;
      else delete (/** @type {any} */ (globalThis))[key];
    }
  }
}
