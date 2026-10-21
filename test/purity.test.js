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

/** The engine's code: it may name no fandom at all, not even the bundled example. */
const CODE_DIRS = ['src', 'api', 'scripts', 'public/js'];
/**
 * The template's prose: it may name the bundled, invented example (it
 * documents it), but no other fandom. The example's data files stay
 * exempt; its seed README doesn't.
 */
const PROSE_DIRS = ['docs', '.github'];
const PROSE_FILES = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md'];
const EXCLUDED_FILES = new Set([path.join('src', 'site', 'generated.js')]);
const EXAMPLE_SITE = 'examples/solluna/site.json';
const ALT_SITE = 'test/fixtures/site-alt/site.json';
const LOCAL_SITE = 'site/site.json';

/**
 * Patterns no scanned file may contain, whatever the fandom: a
 * home-directory path, and a real-looking tweet id (the synthetic fixtures
 * all start `19000000000000000`). Prose also may not point into a sibling
 * checkout's code or fixtures (code's own `../src/` imports are fine).
 */
const ALL_PATTERNS = [
  { name: 'home-directory path', pattern: /\/Users\/|\/home\/[a-z]/u },
  { name: 'real-looking tweet id', pattern: /\b(?!19000000000000000)\d{18,20}\b/u },
];
const PROSE_PATTERNS = [
  ...ALL_PATTERNS,
  { name: 'path into a sibling checkout', pattern: /(?:^|[\s`'"(])\.\.\/[\w.-]+\/(?:test|src|docs|site|examples)\//mu },
];

/** A local (gitignored) `site/site.json`, when there is one and it isn't simply the example. @returns {string[]} */
function localSite() {
  return existsSync(LOCAL_SITE) && readFileSync(LOCAL_SITE, 'utf8') !== readFileSync(EXAMPLE_SITE, 'utf8') ? [LOCAL_SITE] : [];
}

/** @param {string[]} sites @returns {string[]} */
const bannedFrom = (sites) => [...new Set(sites.flatMap(bannedStringsFrom))];

/** @param {string[]} dirs @param {string[]} [files] @returns {string[]} */
function filesIn(dirs, files = []) {
  return [...dirs.flatMap((dir) => listFiles(dir)), ...files.filter((f) => existsSync(f))].filter((file) => !EXCLUDED_FILES.has(file));
}

const codeFiles = () => filesIn(CODE_DIRS);
const proseFiles = () => filesIn(PROSE_DIRS, [
  ...PROSE_FILES,
  ...listFiles('examples').filter((f) => /^examples\/[^/]+\/seed\/README\.md$/.test(f.split(path.sep).join('/'))),
]);

/** @param {string[]} files @param {string[]} banned @returns {string[]} */
function termOffenders(files, banned) {
  return files.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return banned.filter((term) => new RegExp(`\\b${escapeForRegExp(term)}\\b`, 'iu').test(text)).map((term) => `${file}: '${term}'`);
  });
}

/** @param {string[]} files @param {{ name: string, pattern: RegExp }[]} patterns @returns {string[]} */
function patternOffenders(files, patterns) {
  return files.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return patterns.filter(({ pattern }) => pattern.test(text)).map(({ name }) => `${file}: ${name}`);
  });
}

test("purity: the engine's code never mentions a fandom's names, handles, or hashtags", () => {
  const banned = bannedFrom([EXAMPLE_SITE, ALT_SITE, ...localSite()]);
  assert.ok(banned.length >= 6, 'expected several banned strings to check against');
  assert.deepEqual(termOffenders(codeFiles(), banned), []);
});

test("purity: the template's prose names no fandom but the bundled example", () => {
  const banned = bannedFrom([ALT_SITE, ...localSite()]);
  assert.ok(banned.length >= 3, 'expected several banned strings to check against');
  assert.deepEqual(termOffenders(proseFiles(), banned), []);
});

test('purity: no home path or real tweet id anywhere scanned, and no sibling-checkout path in prose', () => {
  assert.deepEqual([...patternOffenders(codeFiles(), ALL_PATTERNS), ...patternOffenders(proseFiles(), PROSE_PATTERNS)], []);
});

test('purity: the scan covers the template prose and docs, and a local site\'s own strings', () => {
  const files = proseFiles().map((f) => f.split(path.sep).join('/'));
  for (const expected of ['docs/spikes.md', 'README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', '.github/workflows/ci.yml', 'examples/solluna/seed/README.md']) {
    assert.ok(files.includes(expected), expected);
  }
  assert.ok(!files.some((f) => f.endsWith('site.json')), 'the example data files stay exempt');
  const altOnly = bannedStringsFrom(ALT_SITE);
  assert.ok(altOnly.every((term) => bannedFrom([ALT_SITE, ...localSite()]).includes(term)));
});
