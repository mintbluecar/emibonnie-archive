// @ts-check
/**
 * The site's public settings and copy, read from `/site/site.js` --
 * written by `scripts/build.js` into `public/site/site.js` (see
 * docs/site-settings.md), served at that absolute path. The build fails
 * on any call to `t()` whose key isn't in the merged copy, so a missing
 * key here only happens for a typo reached at runtime, not committed code.
 */
import { site, copy } from '/site/site.js';

export { site };

const VAR_PATTERN = /\{(\w+)\}/g;

/** @param {string} template @param {Record<string, string|number>} vars @returns {string} */
function substitute(template, vars) {
  return template.replace(VAR_PATTERN, (whole, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : whole));
}

/**
 * Looks up `key` in the merged copy. A missing key warns and returns the
 * key itself, so a page never crashes over wording.
 * @param {string} key
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function t(key, vars) {
  const template = copy[key];
  if (template === undefined) {
    console.warn(`missing copy key: ${key}`);
    return key;
  }
  return vars ? substitute(template, vars) : template;
}

/**
 * The plural-aware form of `t()` (review round 1, M1): looks up
 * `${key}.one` when `n === 1`, else `${key}.other` -- both literal copy
 * keys, so a site can translate/reword either independently, the same
 * as every other key. `n` is always available in the template as `{n}`,
 * alongside any `vars`. `scripts/buildChecks.js`'s missing-key scan
 * recognises a `tCount(…)` call site by its first argument and requires
 * both of that key's suffixes to exist.
 * @param {string} key
 * @param {number} n
 * @param {Record<string, string|number>} [vars]
 * @returns {string}
 */
export function tCount(key, n, vars) {
  return t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...vars });
}
