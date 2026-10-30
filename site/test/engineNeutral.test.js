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
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/** Terms this long are distinctive enough to match anywhere, even inside an identifier. */
const SUBSTRING_MIN_LENGTH = 5;

/**
 * `EMIBONNIE_DB` and `emibonnieArchive` hide a name from `\b...\b` (`_`
 * and letters are word characters), so a term of 5+ characters matches as a
 * case-insensitive substring. A shorter one (`emi`, `leo`) would match
 * inside ordinary words, so it must stand alone: no letter, digit or `_`
 * on either side. Unicode-aware, so a Thai term is bounded the same way.
 * @param {string} term
 */
function termPattern(term) {
  const escaped = escapeForRegExp(term);
  if ([...term].length >= SUBSTRING_MIN_LENGTH) return new RegExp(escaped, 'iu');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu');
}

/**
 * @param {string[]} files @param {string[]} terms
 * @param {string} [root] what `files` are relative to
 * @returns {string[]} `file: 'term'` for each hit
 */
function offenders(files, terms, root = REPO_ROOT) {
  const patterns = terms.map((term) => ({ term, re: termPattern(term) }));
  return files.flatMap((file) => {
    // Every file is scanned, binary ones included: a NUL byte must not hide a
    // name (review of Task 9). latin1 maps each byte to one character, so the
    // ASCII names and handles match the same in text and in media metadata;
    // UTF-8 is read too, or a Thai name could never match.
    const bytes = readFileSync(path.join(root, file));
    const texts = [bytes.toString('utf8'), bytes.toString('latin1')];
    return patterns.filter(({ re }) => texts.some((text) => re.test(text))).map(({ term }) => `${file}: '${term}'`);
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

test('the name guard finds names inside identifiers and in UTF-8', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'name-guard-'));
  try {
    const thai = 'เอมี่บอนนี่';
    writeFileSync(path.join(dir, 'env.js'), 'const url = process.env.EMIBONNIE_DB;\n');
    writeFileSync(path.join(dir, 'ident.js'), 'export const emibonnieArchive = 1;\n');
    writeFileSync(path.join(dir, 'thai.md'), `# ${thai}\n`, 'utf8');
    writeFileSync(path.join(dir, 'short.md'), 'premium leopard, and Leo.\n');
    const files = ['env.js', 'ident.js', 'thai.md', 'short.md'];
    assert.deepEqual(offenders(files, ['emibonnie', thai, 'leo'], dir), [
      "env.js: 'emibonnie'",
      "ident.js: 'emibonnie'",
      `thai.md: '${thai}'`,
      "short.md: 'leo'",
    ]);
    // A short term still needs to stand alone: 'emi' is not in 'premium'.
    assert.deepEqual(offenders(['short.md'], ['emi'], dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
