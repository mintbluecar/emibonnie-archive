// @ts-check
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Recursively lists files under `dir` ending in `ext`, each with its text.
 * @param {string} dir
 * @param {string} ext
 * @returns {{ path: string, text: string }[]}
 */
export function walkFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  /** @type {{ path: string, text: string }[]} */
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, ext));
    } else if (entry.isFile() && full.endsWith(ext)) {
      results.push({ path: full, text: readFileSync(full, 'utf8') });
    }
  }
  return results;
}

/**
 * `var(--name)` references in a CSS source.
 * @param {string} cssText
 * @returns {string[]}
 */
export function findUsedCssTokens(cssText) {
  const matches = [...cssText.matchAll(/var\((--[a-zA-Z0-9-]+)/g)];
  return [...new Set(matches.map((match) => match[1]))];
}

/**
 * `--name: value;` custom-property definitions in a CSS source.
 * @param {string} cssText
 * @returns {Set<string>}
 */
export function findDefinedCssTokens(cssText) {
  const matches = [...cssText.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)];
  return new Set(matches.map((match) => match[1]));
}

/**
 * Every font-family name quoted inside a custom-property declaration's
 * value, across `cssTexts` -- `--font-heading: 'A', 'B', sans-serif;`
 * yields `{A, B}`, and so does a declaration with no trailing `;`
 * because it's the last one before the block's closing `}`
 * (`--font-heading: 'A' }`). Shared by `buildAssets.js`'s
 * `buildFontsCss` (which site fonts a token actually points at, spec
 * "2b. Fonts a site can choose": "a site family that's never pointed at
 * by a token isn't shipped") and the theme test (a font token may only
 * name a family the engine ships or the site declares in `site.json`).
 * @param {string[]} cssTexts
 * @returns {Set<string>}
 */
export function findFontFamilyReferences(cssTexts) {
  const names = new Set();
  for (const cssText of cssTexts) {
    for (const declaration of cssText.matchAll(/--[a-zA-Z0-9-]+\s*:\s*([^;}]+)[;}]/g)) {
      for (const quoted of declaration[1].matchAll(/['"]([^'"]+)['"]/g)) names.add(quoted[1]);
    }
  }
  return names;
}

/**
 * Font family names `findFontFamilyReferences` finds in `cssTexts` that
 * aren't in `allowedFamilies` (case-insensitive).
 * @param {string[]} cssTexts
 * @param {string[]} allowedFamilies
 * @returns {string[]}
 */
export function findUndeclaredFontFamilies(cssTexts, allowedFamilies) {
  const allowed = new Set(allowedFamilies.map((family) => family.toLowerCase()));
  return [...findFontFamilyReferences(cssTexts)].filter((name) => !allowed.has(name.toLowerCase()));
}

/**
 * Every `var(--x)` used across `cssSources` that `tokensCss` doesn't define.
 * @param {{ path: string, text: string }[]} cssSources
 * @param {string} tokensCss
 * @returns {string[]}
 */
export function findMissingCssTokens(cssSources, tokensCss) {
  const defined = findDefinedCssTokens(tokensCss);
  const missing = new Set();
  for (const { text } of cssSources) {
    for (const token of findUsedCssTokens(text)) {
      if (!defined.has(token)) missing.add(token);
    }
  }
  return [...missing];
}

/**
 * `t('key')` / `t("key")` calls in a JS source.
 * @param {string} jsText
 * @returns {string[]}
 */
export function findUsedCopyKeys(jsText) {
  const matches = [...jsText.matchAll(/\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]\s*\)/g)];
  return [...new Set(matches.map((match) => match[1]))];
}

/**
 * `tCount('key', …)` calls in a JS source (review round 1, M1) -- the
 * plural-aware form always takes further args (`n`, maybe `vars`), so
 * unlike `findUsedCopyKeys` this doesn't require the call to end right
 * after the key.
 * @param {string} jsText
 * @returns {string[]}
 */
export function findUsedCountKeys(jsText) {
  const matches = [...jsText.matchAll(/\btCount\(\s*['"]([a-zA-Z0-9_.]+)['"]/g)];
  return [...new Set(matches.map((match) => match[1]))];
}

/**
 * Every `t('key')` used across `jsSources` that `copy` doesn't define,
 * plus every `tCount('key', …)` whose `key.one`/`key.other` aren't both
 * defined (review round 1, M1).
 * @param {{ path: string, text: string }[]} jsSources
 * @param {Record<string, string>} copy
 * @returns {string[]}
 */
export function findMissingCopyKeys(jsSources, copy) {
  const missing = new Set();
  for (const { text } of jsSources) {
    for (const key of findUsedCopyKeys(text)) {
      if (!(key in copy)) missing.add(key);
    }
    for (const key of findUsedCountKeys(text)) {
      for (const suffix of ['one', 'other']) {
        if (!(`${key}.${suffix}` in copy)) missing.add(`${key}.${suffix}`);
      }
    }
  }
  return [...missing];
}
