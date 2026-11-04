// @ts-check
/**
 * The one debounce the front end uses: an in-place search box waits this
 * long after the last keystroke before it refetches
 * (`components/inlineSearch.js`, `pages/adminEvents.js`).
 */

/** @param {(value: string) => void} fn @param {number} ms @returns {(value: string) => void} */
export function debounced(fn, ms) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  return (value) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(value), ms);
  };
}
