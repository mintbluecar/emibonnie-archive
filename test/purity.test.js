// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Handles, display names, wordmark accent, and ignored hashtags from one
 * example site -- the strings the engine must never mention.
 * @param {string} filePath
 * @returns {string[]}
 */
function bannedStringsFrom(filePath) {
  const site = JSON.parse(readFileSync(filePath, 'utf8'));
  const strings = [
    ...site.featuredPeople.flatMap((/** @type {any} */ person) => [person.igHandle, person.displayName]),
    site.wordmark.accent,
    ...site.ignoredHashtags,
  ];
  return [...new Set(strings)].filter((value) => typeof value === 'string' && value.length > 0);
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...listFiles(full));
    else results.push(full);
  }
  return results;
}

/** @param {string} value */
function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SCAN_DIRS = ['src', 'api', 'scripts', 'public/js'];
const EXCLUDED_FILES = new Set([path.join('src', 'site', 'generated.js')]);

test("purity: the engine never mentions a fandom's names, handles, or hashtags", () => {
  const banned = [
    ...bannedStringsFrom('examples/solluna/site.json'),
    ...bannedStringsFrom('test/fixtures/site-alt/site.json'),
  ];
  assert.ok(banned.length >= 6, 'expected several banned strings to check against');

  const files = SCAN_DIRS.flatMap((dir) => listFiles(dir)).filter((file) => !EXCLUDED_FILES.has(file));
  /** @type {string[]} */
  const offenders = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const term of banned) {
      if (new RegExp(`\\b${escapeForRegExp(term)}\\b`, 'iu').test(text)) offenders.push(`${file}: '${term}'`);
    }
  }
  assert.deepEqual(offenders, []);
});
