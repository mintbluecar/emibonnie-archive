// @ts-check
/**
 * Name-leak guard for this site repo: no emibonnie name, handle or
 * translator handle may appear in an engine-owned file. Engine-owned means
 * every file git tracks (or would track: untracked, not ignored) outside
 * `site/`, `docs/superpowers/` and `.superpowers/`. The engine's own
 * `test/purity.test.js` covers the engine's code; this also covers its
 * prose, examples and tests, so an engine change made in this repo by
 * mistake (instead of upstream) is caught before it can leak back.
 *
 * It lives here, not in the engine's `test/`, so the engine stays
 * untouched; `npm test` doesn't pick it up. Run it with
 * `node --test site/test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SITE_DIR = path.join(REPO_ROOT, 'site');
const EXCLUDED_PREFIXES = ['site/', 'docs/superpowers/', '.superpowers/'];

/** @param {string} file @returns {any} */
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/**
 * The site's identifying strings. `wordmark.rest` ("archive") is left out:
 * it's a plain English word the engine legitimately uses everywhere.
 * @returns {string[]}
 */
function siteStrings() {
  const site = readJson(path.join(SITE_DIR, 'site.json'));
  const maps = readJson(path.join(SITE_DIR, 'seed', 'maps.json'));
  const people = [...site.featuredPeople, ...(maps.createPeople ?? [])];
  const strings = [
    site.name,
    site.wordmark.accent,
    ...people.flatMap((/** @type {any} */ p) => [p.igHandle, p.displayName]),
    ...site.featuredPeople.flatMap((/** @type {any} */ p) => (p.otherAccounts ?? []).map((/** @type {any} */ a) => a.handle)),
    ...translatorHandles(),
  ];
  return [...new Set(strings.filter((s) => typeof s === 'string' && s.length > 0))];
}

/** The credited authors of the seed posts. @returns {string[]} */
function translatorHandles() {
  const dir = path.join(SITE_DIR, 'seed', 'tweets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).flatMap((f) => {
    const data = readJson(path.join(dir, f));
    return [data.user?.screen_name, data.status?.author?.screen_name];
  });
}

/** @returns {string[]} repo-relative paths of engine-owned files */
function engineFiles() {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean)
    .filter((f) => !EXCLUDED_PREFIXES.some((prefix) => f.startsWith(prefix)))
    .filter((f) => existsSync(path.join(REPO_ROOT, f)));
}

/** @param {string} value */
const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string[]} files @param {string[]} terms
 * @returns {string[]} `file: 'term'` for each hit
 */
function offenders(files, terms) {
  const patterns = terms.map((term) => ({ term, re: new RegExp(`\\b${escapeForRegExp(term)}\\b`, 'iu') }));
  return files.flatMap((file) => {
    // Every file is scanned, binary ones included: a NUL byte must not hide a
    // name (review of Task 9). latin1 maps each byte to one character, so the
    // ASCII names and handles match the same in text and in media metadata.
    const text = readFileSync(path.join(REPO_ROOT, file)).toString('latin1');
    return patterns.filter(({ re }) => re.test(text)).map(({ term }) => `${file}: '${term}'`);
  });
}

test('engine-owned files never mention this site\'s people, handles or translators', () => {
  const terms = siteStrings();
  for (const expected of ['emibonnie', 'emiamily', 'beonnnie', 'leo_saussay']) assert.ok(terms.includes(expected), expected);
  assert.ok(terms.length >= 10, `expected the site's names, handles and translators, got ${terms.length}`);
  assert.deepEqual(offenders(engineFiles(), terms), []);
});

test('the guard scans the engine and skips only the site-owned folders', () => {
  const files = engineFiles();
  for (const expected of ['package.json', 'src/site/schema.js', 'docs/start-your-own.md', 'examples/solluna/site.json', 'e2e/smoke.spec.js']) {
    assert.ok(files.includes(expected), expected);
  }
  assert.ok(!files.some((f) => EXCLUDED_PREFIXES.some((prefix) => f.startsWith(prefix))));
});

test('the guard catches a planted name', () => {
  assert.deepEqual(offenders(['package.json'], ['fan-archive']), ["package.json: 'fan-archive'"]);
});
