// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, readFileSync, existsSync, cpSync } from 'node:fs';
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
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fan-archive-build-'));
  try {
    cpSync('src', path.join(repoRoot, 'src'), { recursive: true });
    cpSync('examples/solluna', path.join(repoRoot, 'site'), { recursive: true });

    await runBuild({ repoRoot, siteDir: path.join(repoRoot, 'site') });

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
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fan-archive-build-'));
  try {
    cpSync('src', path.join(repoRoot, 'src'), { recursive: true });
    cpSync('examples/solluna', path.join(repoRoot, 'site'), { recursive: true });
    await import('node:fs').then(({ writeFileSync }) =>
      writeFileSync(path.join(repoRoot, 'site/site.json'), JSON.stringify({ name: 'x' })),
    );

    await assert.rejects(() => runBuild({ repoRoot, siteDir: path.join(repoRoot, 'site') }));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
