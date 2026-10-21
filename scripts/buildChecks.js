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
 * Every `t('key')` used across `jsSources` that `copy` doesn't define.
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
  }
  return [...missing];
}
