// @ts-check
/**
 * The engine stays fandom-neutral (spec, "Reusable template"): its files
 * may name no real fandom's people, handles or hashtags, no real tweet id,
 * and no one's home directory. It must hold inside any site repo too (Task
 * 9a item 1), so this scans **engine-owned** files only: the paths a site
 * repo owns (`test/helpers/siteRepo.js`: `site/`, `.superpowers/`,
 * `docs/superpowers/`) are never read.
 *
 * Which names each part may not mention:
 * - code (`src/`, `api/`, `scripts/`, `public/js/`): no fandom at all, not
 *   even the bundled example's;
 * - prose (docs, READMEs, CI): the bundled example only;
 * - tests (`test/`, `e2e/`): the example and the engine's own second test
 *   fixture (`test/fixtures/site-alt/`) freely, but never a real site's.
 * A real site's names come from a local `site/` that isn't simply the
 * example: its `site.json` (featured people, wordmark accent, ignored
 * hashtags) and its seed's `createPeople`, minus anything the example
 * itself uses -- the seed is where a site's other people (a host, a
 * guest) live, and it's how one reached engine tests before.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROLES } from '../src/domain/constants.js';
import { isSiteOwned } from './helpers/siteRepo.js';

const EXAMPLE_DIR = 'examples/solluna';
const ALT_SITE_DIR = 'test/fixtures/site-alt';
const LOCAL_SITE_DIR = 'site';

/** @param {string} dir @param {string} file @returns {any} */
function readJsonIn(dir, file) {
  const full = path.join(dir, file);
  return existsSync(full) ? JSON.parse(readFileSync(full, 'utf8')) : null;
}

/**
 * Handles, display names, wordmark accent and ignored hashtags of one site
 * folder, plus its seed's `createPeople` (generic role words such as
 * "host" are never names).
 * @param {string} dir
 * @returns {string[]}
 */
function namesOfSite(dir) {
  const site = readJsonIn(dir, 'site.json');
  if (!site) return [];
  const seedPeople = readJsonIn(dir, 'seed/maps.json')?.createPeople ?? [];
  const strings = [
    ...[...site.featuredPeople, ...seedPeople].flatMap((/** @type {any} */ person) => [person.igHandle, person.displayName]),
    site.wordmark.accent,
    ...site.ignoredHashtags,
  ];
  return [...new Set(strings)].filter((value) => typeof value === 'string' && value.length > 0 && !ROLES.includes(value.toLowerCase()));
}

/** A real site's own names: a local `site/`'s, minus the bundled example's. @returns {string[]} */
function localSiteNames() {
  const example = new Set(namesOfSite(EXAMPLE_DIR).map((name) => name.toLowerCase()));
  return namesOfSite(LOCAL_SITE_DIR).filter((name) => !example.has(name.toLowerCase()));
}

/** Every file under `dir`, repo-relative, skipping what a site repo owns. @param {string} dir @returns {string[]} */
function listFiles(dir) {
  if (!existsSync(dir) || isSiteOwned(dir)) return [];
  /** @type {string[]} */
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (isSiteOwned(full)) continue;
    if (entry.isDirectory()) results.push(...listFiles(full));
    else results.push(full);
  }
  return results;
}

/** @param {string} value */
function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const CODE_DIRS = ['src', 'api', 'scripts', 'public/js'];
const PROSE_DIRS = ['docs', '.github'];
const PROSE_FILES = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md'];
const TEST_DIRS = ['test', 'e2e'];
/** Generated, or binary media: nothing to read as text. */
const EXCLUDED_FILES = new Set([path.join('src', 'site', 'generated.js')]);
const BINARY = /\.(?:png|webm|mp4|jpg|woff2?)$/;

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

/** @param {string[]} dirs @param {string[]} [files] @returns {string[]} */
function filesIn(dirs, files = []) {
  return [...dirs.flatMap((dir) => listFiles(dir)), ...files.filter((f) => existsSync(f))]
    .filter((file) => !EXCLUDED_FILES.has(file) && !BINARY.test(file));
}

const codeFiles = () => filesIn(CODE_DIRS);
const proseFiles = () => filesIn(PROSE_DIRS, [
  ...PROSE_FILES,
  ...listFiles('examples').filter((f) => /^examples\/[^/]+\/seed\/README\.md$/.test(f.split(path.sep).join('/'))),
]);
const testFiles = () => filesIn(TEST_DIRS);

/** @param {string[]} files @param {string[]} banned @returns {string[]} */
function termOffenders(files, banned) {
  return files.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return banned.filter((term) => new RegExp(`(?<![\\p{L}\\p{N}_])${escapeForRegExp(term)}(?![\\p{L}\\p{N}_])`, 'iu').test(text))
      .map((term) => `${file}: '${term}'`);
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
  const banned = [...new Set([...namesOfSite(EXAMPLE_DIR), ...namesOfSite(ALT_SITE_DIR), ...localSiteNames()])];
  assert.ok(banned.length >= 6, 'expected several banned strings to check against');
  assert.deepEqual(termOffenders(codeFiles(), banned), []);
});

test("purity: the template's prose names no fandom but the bundled example", () => {
  const banned = [...new Set([...namesOfSite(ALT_SITE_DIR), ...localSiteNames()])];
  assert.ok(banned.length >= 3, 'expected several banned strings to check against');
  assert.deepEqual(termOffenders(proseFiles(), banned), []);
});

test("purity: the engine's tests and e2e specs never name a real site's people (Task 9a item 1)", () => {
  assert.deepEqual(termOffenders(testFiles(), localSiteNames()), []);
});

test('purity: no home path or real tweet id anywhere scanned, and no sibling-checkout path in prose', () => {
  assert.deepEqual([
    ...patternOffenders([...codeFiles(), ...testFiles()], ALL_PATTERNS),
    ...patternOffenders(proseFiles(), PROSE_PATTERNS),
  ], []);
});

test('purity: the scan covers the template prose, tests and e2e, but nothing a site repo owns', () => {
  const posix = (/** @type {string[]} */ files) => files.map((f) => f.split(path.sep).join('/'));
  const prose = posix(proseFiles());
  for (const expected of ['docs/spikes.md', 'README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', '.github/workflows/ci.yml', 'examples/solluna/seed/README.md']) {
    assert.ok(prose.includes(expected), expected);
  }
  assert.ok(!prose.some((f) => f.endsWith('site.json')), 'the example data files stay exempt');
  const tests = posix(testFiles());
  for (const expected of ['test/purity.test.js', 'test/components/previewCard.test.js', 'test/repo/people.test.js', 'e2e/smoke.spec.js']) {
    assert.ok(tests.includes(expected), expected);
  }
  const all = posix([...codeFiles(), ...proseFiles(), ...testFiles()]);
  assert.deepEqual(all.filter((f) => isSiteOwned(f)), []);
  for (const owned of ['site/site.json', '.superpowers/notes.md', 'docs/superpowers/specs/x.md']) assert.ok(isSiteOwned(owned), owned);
  assert.ok(!isSiteOwned('docs/site-settings.md') && !isSiteOwned('test/site/build.test.js'), 'engine paths that only look similar are scanned');
});

test('purity: a local site\'s seed people count as its names, generic roles never do', () => {
  const example = namesOfSite(EXAMPLE_DIR);
  assert.ok(example.includes('starguest') && example.includes('host_x'), 'seed createPeople handles are included');
  assert.ok(!example.includes('host'), "the role word 'host' is not a name");
});

test('purity: a planted name is caught as a whole word, in any script and case, and only as a whole word', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fan-archive-purity-'));
  try {
    const file = path.join(dir, 'planted.test.js');
    writeFileSync(file, "const p = { emoji: '🦊', name: 'Zephyr', igHandle: 'มะลิ_x' }; // zephyrine\n");
    assert.deepEqual(termOffenders([file], ['zephyr', 'มะลิ_x', 'ephyr']), [`${file}: 'zephyr'`, `${file}: 'มะลิ_x'`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
