// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, readFileSync, existsSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  findMissingCssTokens,
  findMissingCopyKeys,
  findUsedCountKeys,
} from '../../scripts/buildChecks.js';
import {
  buildPublicSiteModule,
  buildKindsRegistryModule,
  buildVercelConfig,
  SECURITY_HEADERS,
} from '../../scripts/buildOutputs.js';
import { runBuild } from '../../scripts/build.js';
import { loadSite } from '../../src/site/loadSite.js';

const TOKENS_CSS = readFileSync('src/styles/tokens.css', 'utf8');

/**
 * A temp repo root with a real copy of `src/` and `examples/solluna/`
 * (as `site/`), so `runBuild` can run end to end without touching this
 * checkout. Caller must `rmSync(repoRoot, { recursive: true, force: true })`.
 * @returns {{ repoRoot: string, siteDir: string }}
 */
function makeBuildRepoRoot() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fan-archive-build-'));
  cpSync('src', path.join(repoRoot, 'src'), { recursive: true });
  cpSync('examples/solluna', path.join(repoRoot, 'site'), { recursive: true });
  cpSync('robots.txt', path.join(repoRoot, 'robots.txt'));
  return { repoRoot, siteDir: path.join(repoRoot, 'site') };
}

test('findMissingCssTokens: fails when engine CSS uses var(--missing)', () => {
  const missing = findMissingCssTokens(
    [{ path: 'fixture.css', text: '.card { color: var(--missing); }' }],
    TOKENS_CSS,
  );
  assert.deepEqual(missing, ['--missing']);
});

test('findMissingCssTokens: passes when every used token is defined', () => {
  const missing = findMissingCssTokens(
    [{ path: 'fixture.css', text: '.card { background: var(--color-card); }' }],
    TOKENS_CSS,
  );
  assert.deepEqual(missing, []);
});

test("findMissingCopyKeys: fails when code uses t('nope.key')", () => {
  const missing = findMissingCopyKeys(
    [{ path: 'fixture.js', text: "t('nope.key')" }],
    { 'nav.home': 'home' },
  );
  assert.deepEqual(missing, ['nope.key']);
});

test('findMissingCopyKeys: passes when every t() key exists in copy', () => {
  const missing = findMissingCopyKeys(
    [{ path: 'fixture.js', text: "t('nav.home')" }],
    { 'nav.home': 'home' },
  );
  assert.deepEqual(missing, []);
});

test('findUsedCountKeys: finds tCount(\'key\', …) calls regardless of their further args', () => {
  assert.deepEqual(findUsedCountKeys("tCount('person.translations', n, { x: 1 })"), ['person.translations']);
  assert.deepEqual(findUsedCountKeys("tCount('a.b', 1)"), ['a.b']);
});

test('findMissingCopyKeys: requires both .one and .other for a tCount() key (review round 1, M1)', () => {
  const missing = findMissingCopyKeys(
    [{ path: 'fixture.js', text: "tCount('person.translations', n)" }],
    { 'nav.home': 'home' },
  );
  assert.deepEqual(missing.sort(), ['person.translations.one', 'person.translations.other']);
});

test('findMissingCopyKeys: a tCount() key with both suffixes defined passes', () => {
  const missing = findMissingCopyKeys(
    [{ path: 'fixture.js', text: "tCount('person.translations', n)" }],
    { 'person.translations.one': '{n} translation', 'person.translations.other': '{n} translations' },
  );
  assert.deepEqual(missing, []);
});

test('buildPublicSiteModule: excludes ownerXUserId', () => {
  const site = loadSite('examples/solluna');
  const source = buildPublicSiteModule(site);
  assert.ok(!source.includes('ownerXUserId'));
  assert.ok(source.includes('"name": "solluna archive"'));
});

test('buildPublicSiteModule: carries the site logo path (Plan 1b Task 2: header.js reads site.logo), null by default', () => {
  const site = loadSite('examples/solluna');
  assert.ok(buildPublicSiteModule(site).includes('"logo": null'));
  assert.ok(buildPublicSiteModule(site, {}, { logo: '/site/logo.svg' }).includes('"logo": "/site/logo.svg"'));
});

test('buildKindsRegistryModule: an empty kind list is a valid, empty registry', () => {
  const source = buildKindsRegistryModule([]);
  assert.ok(source.includes('export const kindsRegistry = {\n\n};'));
});

test('buildKindsRegistryModule: default-imports each kind, so entries are Kind objects (no .default)', () => {
  const source = buildKindsRegistryModule(['translation']);
  assert.ok(source.includes("import kind0 from './translation/index.js';"));
  assert.ok(source.includes('  "translation": kind0,'));
  assert.ok(!source.includes('* as'));
});

test('buildVercelConfig: region, security headers (Referrer-Policy: no-referrer), buildCommand', () => {
  const site = loadSite('examples/solluna');
  const config = buildVercelConfig(site, []);
  assert.deepEqual(config.regions, ['sin1']);
  assert.equal(config.buildCommand, 'npm run build');
  assert.deepEqual(config.headers[0], { source: '/(.*)', headers: SECURITY_HEADERS });
  const referrerPolicy = SECURITY_HEADERS.find((h) => h.key === 'Referrer-Policy');
  assert.equal(referrerPolicy?.value, 'no-referrer');
  // /build/* (Plan 1b's hashed esbuild output) is cached forever: a content change is always a new filename.
  const buildHeaders = config.headers.find((/** @type {any} */ h) => h.source === '/build/(.*)');
  assert.deepEqual(buildHeaders?.headers, [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }]);
  assert.equal(config.rewrites, undefined);
});

test('runBuild: vercel.json rewrites /search to search.html, so the static page resolves in production (cleanUrls is off, review round 1, C1)', async () => {
  const { repoRoot, siteDir } = makeBuildRepoRoot();
  try {
    await runBuild({ repoRoot, siteDir });
    const vercelJson = JSON.parse(readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));
    assert.ok(
      vercelJson.rewrites.some((/** @type {any} */ r) => r.source === '/search' && r.destination === '/search.html'),
      JSON.stringify(vercelJson.rewrites),
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runBuild: builds examples/solluna end to end into a temp repo root', async () => {
  const { repoRoot, siteDir } = makeBuildRepoRoot();
  try {
    await runBuild({ repoRoot, siteDir });

    assert.ok(existsSync(path.join(repoRoot, 'src/site/generated.js')));
    assert.ok(existsSync(path.join(repoRoot, 'src/kinds/_registry.js')));
    assert.ok(existsSync(path.join(repoRoot, 'public/js/kinds/_registry.js')));
    assert.ok(existsSync(path.join(repoRoot, 'public/site/site.js')));
    assert.ok(
      readFileSync(path.join(repoRoot, 'public/site/site.js'), 'utf8').includes('"logo": "/site/logo.svg"'),
      'the public site module carries the copied logo path too, not just src/site/generated.js',
    );
    assert.ok(existsSync(path.join(repoRoot, 'public/site/tokens.css')));
    assert.ok(existsSync(path.join(repoRoot, 'public/site/theme.css')));
    assert.ok(existsSync(path.join(repoRoot, 'public/site/logo.svg')));
    assert.equal(readFileSync(path.join(repoRoot, 'public/robots.txt'), 'utf8'), readFileSync('robots.txt', 'utf8'), 'robots.txt is served from public/');

    const vercelJson = JSON.parse(readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));
    assert.deepEqual(vercelJson.regions, ['sin1']);
    // a rewrite for each page route: the item pages (one per kind's urlPrefix), the event page,
    // and every static page with a file (review round 1, C1: Vercel's cleanUrls defaults to
    // false, so a static page needs an explicit rewrite -- it doesn't resolve to <path>.html
    // on its own).
    const core = [
      { source: '/e/:slug', destination: '/api/meta/e/:slug' },
      { source: '/t/:id', destination: '/api/meta/t/:id' },
      { source: '/search', destination: '/search.html' },
      { source: '/p/:ig', destination: '/person.html' },
      { source: '/tl/:handle', destination: '/account.html' },
      { source: '/about', destination: '/about.html' },
      { source: '/privacy', destination: '/privacy.html' },
      { source: '/takedown', destination: '/takedown.html' },
    ];
    for (const rewrite of core) assert.ok(vercelJson.rewrites.some((/** @type {any} */ r) => r.source === rewrite.source && r.destination === rewrite.destination), rewrite.source);
    // ...and exactly those plus one per added kind (after the event page) and per added static page (at the end).
    const { kindsRegistry } = await import('../../src/kinds/_registry.js');
    const { pages } = await import('../../src/pages.js');
    const kindRewrites = Object.values(kindsRegistry).map((k) => ({ source: `${k.urlPrefix}:id`, destination: `/api/meta${k.urlPrefix}:id` }));
    const added = pages.filter((p) => p.file && p.path !== '/' && !core.some((r) => r.source === p.path));
    assert.deepEqual(vercelJson.rewrites, [
      core[0], ...kindRewrites, ...core.slice(2), ...added.map((p) => ({ source: p.path, destination: `/${p.file}` })),
    ]);
    const headers = vercelJson.headers[0].headers;
    assert.match(headers.find((/** @type {any} */ h) => h.key === 'Content-Security-Policy').value, /frame-ancestors 'none'/);
    assert.equal(headers.find((/** @type {any} */ h) => h.key === 'Referrer-Policy').value, 'no-referrer');
    assert.ok(headers.some((/** @type {any} */ h) => h.key === 'Strict-Transport-Security'));
    assert.ok(headers.some((/** @type {any} */ h) => h.key === 'X-Content-Type-Options'));
    assert.deepEqual(vercelJson.functions, { 'api/*.js': { includeFiles: 'public/{item,event}.html' } });

    const generated = readFileSync(path.join(repoRoot, 'src/site/generated.js'), 'utf8');
    assert.ok(generated.includes('export const site ='));
    assert.ok(generated.includes('export const copy ='));
    assert.ok(generated.includes('export const assets = {"logo":"/site/logo.svg"}'));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runBuild: fails when site.json is invalid', async () => {
  const { repoRoot, siteDir } = makeBuildRepoRoot();
  try {
    writeFileSync(path.join(siteDir, 'site.json'), JSON.stringify({ name: 'x' }));

    await assert.rejects(() => runBuild({ repoRoot, siteDir }));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runBuild: fails end to end when engine CSS uses var(--missing)', async () => {
  const { repoRoot, siteDir } = makeBuildRepoRoot();
  try {
    writeFileSync(path.join(repoRoot, 'src/styles/broken.css'), '.x { color: var(--missing); }');

    await assert.rejects(() => runBuild({ repoRoot, siteDir }), /undefined token\(s\): --missing/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("runBuild: fails end to end when code uses t('nope.key')", async () => {
  const { repoRoot, siteDir } = makeBuildRepoRoot();
  try {
    mkdirSync(path.join(repoRoot, 'src/routes'), { recursive: true });
    writeFileSync(path.join(repoRoot, 'src/routes/broken.js'), "export const x = t('nope.key');");

    await assert.rejects(() => runBuild({ repoRoot, siteDir }), /undefined copy key\(s\): nope\.key/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
