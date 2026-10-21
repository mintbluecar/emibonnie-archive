// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, readFileSync, existsSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  findMissingCssTokens,
  findMissingCopyKeys,
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

test('buildPublicSiteModule: excludes ownerXUserId', () => {
  const site = loadSite('examples/solluna');
  const source = buildPublicSiteModule(site);
  assert.ok(!source.includes('ownerXUserId'));
  assert.ok(source.includes('"name": "solluna archive"'));
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
  assert.deepEqual(config.headers, [{ source: '/(.*)', headers: SECURITY_HEADERS }]);
  const referrerPolicy = SECURITY_HEADERS.find((h) => h.key === 'Referrer-Policy');
  assert.equal(referrerPolicy?.value, 'no-referrer');
  assert.equal(config.rewrites, undefined);
});

test('runBuild: builds examples/solluna end to end into a temp repo root', async () => {
  const { repoRoot, siteDir } = makeBuildRepoRoot();
  try {
    await runBuild({ repoRoot, siteDir });

    assert.ok(existsSync(path.join(repoRoot, 'src/site/generated.js')));
    assert.ok(existsSync(path.join(repoRoot, 'src/kinds/_registry.js')));
    assert.ok(existsSync(path.join(repoRoot, 'public/site/site.js')));
    assert.ok(existsSync(path.join(repoRoot, 'public/site/tokens.css')));
    assert.ok(existsSync(path.join(repoRoot, 'public/site/theme.css')));
    assert.ok(existsSync(path.join(repoRoot, 'public/site/logo.svg')));

    const vercelJson = JSON.parse(readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));
    assert.deepEqual(vercelJson.regions, ['sin1']);

    const generated = readFileSync(path.join(repoRoot, 'src/site/generated.js'), 'utf8');
    assert.ok(generated.includes('export const site ='));
    assert.ok(generated.includes('export const copy ='));
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
