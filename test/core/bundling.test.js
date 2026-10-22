// @ts-check
/**
 * End-to-end bundling: esbuild output + manifest.json, self-hosted font
 * files, and the HTML placeholder rewrite, all driven through the real
 * `runBuild()` against a temp repo root (same pattern as
 * test/site/build.test.js, which covers the non-bundling parts of the
 * build).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, readFileSync, existsSync, cpSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBuild } from '../../scripts/build.js';

/**
 * A temp repo root with `src/`, the solluna example as `site/`, and one
 * fixture page (`public/js/pages/home.js` + `public/index.html` with
 * asset placeholders), so `runBuild` bundles something real.
 * @returns {{ repoRoot: string, siteDir: string }}
 */
function makeBundlingRepoRoot() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fan-archive-bundle-'));
  cpSync('src', path.join(repoRoot, 'src'), { recursive: true });
  cpSync('examples/solluna', path.join(repoRoot, 'site'), { recursive: true });
  cpSync('robots.txt', path.join(repoRoot, 'robots.txt'));

  mkdirSync(path.join(repoRoot, 'public/js/pages'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'public/js/pages/home.js'), "export function start() { console.log('home'); }\n");

  writeFileSync(
    path.join(repoRoot, 'public/index.html'),
    '<!doctype html>\n<html lang="en"><head>\n' +
      '<link rel="stylesheet" href="{{asset:app.css}}">\n' +
      '<link rel="stylesheet" href="{{asset:fonts.css}}">\n' +
      '</head><body>\n<script type="module" src="{{asset:js:home}}"></script>\n</body></html>\n',
  );

  return { repoRoot, siteDir: path.join(repoRoot, 'site') };
}

test('runBuild: bundles one page, writes a manifest, and rewrites the page HTML placeholders', async () => {
  const { repoRoot, siteDir } = makeBundlingRepoRoot();
  try {
    await runBuild({ repoRoot, siteDir });

    const manifestPath = path.join(repoRoot, 'public/build/manifest.json');
    assert.ok(existsSync(manifestPath), 'manifest.json is written');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    assert.match(manifest.pages.home, /^home-.+\.js$/);
    assert.ok(existsSync(path.join(repoRoot, 'public/build', manifest.pages.home)), 'the hashed page JS exists on disk');

    assert.match(manifest.appCss, /^app-.+\.css$/);
    assert.ok(existsSync(path.join(repoRoot, 'public/build', manifest.appCss)));

    assert.match(manifest.fontsCss, /^fonts-.+\.css$/);
    assert.ok(existsSync(path.join(repoRoot, 'public/build', manifest.fontsCss)));

    const html = readFileSync(path.join(repoRoot, 'public/index.html'), 'utf8');
    assert.ok(!html.includes('{{asset:'), 'no placeholder is left in the page HTML');
    assert.ok(html.includes(`/build/${manifest.pages.home}`));
    assert.ok(html.includes(`/build/${manifest.appCss}`));
    assert.ok(html.includes(`/build/${manifest.fontsCss}`));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runBuild: self-hosts only woff2 files, for weights 400/600/700(/800), latin + thai', async () => {
  const { repoRoot, siteDir } = makeBundlingRepoRoot();
  try {
    await runBuild({ repoRoot, siteDir });
    const fontsDir = path.join(repoRoot, 'public/build/fonts');
    const files = readdirSync(fontsDir);
    assert.ok(files.length > 0, 'at least one font file was copied');
    for (const file of files) {
      assert.ok(file.endsWith('.woff2'), `${file} is a woff2 file`);
      assert.match(file, /-(400|600|700|800)-normal\.woff2$/);
    }
    assert.ok(files.some((f) => f.includes('nunito') && f.includes('latin')));
    assert.ok(files.some((f) => f.includes('ibm-plex-sans-thai') && f.includes('thai')));

    const fontsCss = readFileSync(path.join(repoRoot, 'public/build', JSON.parse(readFileSync(path.join(repoRoot, 'public/build/manifest.json'), 'utf8')).fontsCss), 'utf8');
    assert.match(fontsCss, /font-display:\s*swap/);
    assert.ok(!fontsCss.includes('fonts.googleapis.com'), 'no Google Fonts origin');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runBuild: /build/* gets an immutable cache header, and the CSP has font-src self with no Google Fonts', async () => {
  const { repoRoot, siteDir } = makeBundlingRepoRoot();
  try {
    await runBuild({ repoRoot, siteDir });
    const vercelJson = JSON.parse(readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));

    const buildHeaderEntry = vercelJson.headers.find((/** @type {any} */ h) => h.source === '/build/(.*)');
    assert.ok(buildHeaderEntry, 'a header block targets /build/*');
    const cacheControl = buildHeaderEntry.headers.find((/** @type {any} */ h) => h.key === 'Cache-Control');
    assert.equal(cacheControl?.value, 'public, max-age=31536000, immutable');

    const csp = vercelJson.headers[0].headers.find((/** @type {any} */ h) => h.key === 'Content-Security-Policy').value;
    assert.match(csp, /font-src 'self'/);
    assert.ok(!csp.includes('fonts.googleapis.com') && !csp.includes('fonts.gstatic.com'));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runBuild: with no public/js/pages directory, bundling is a no-op (empty manifest, no crash)', async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fan-archive-bundle-empty-'));
  try {
    cpSync('src', path.join(repoRoot, 'src'), { recursive: true });
    cpSync('examples/solluna', path.join(repoRoot, 'site'), { recursive: true });
    cpSync('robots.txt', path.join(repoRoot, 'robots.txt'));

    await runBuild({ repoRoot, siteDir: path.join(repoRoot, 'site') });

    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'public/build/manifest.json'), 'utf8'));
    assert.deepEqual(manifest.pages, {});
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runBuild: an unresolved asset placeholder fails the build loudly', async () => {
  const { repoRoot, siteDir } = makeBundlingRepoRoot();
  try {
    writeFileSync(path.join(repoRoot, 'public/broken.html'), '<script type="module" src="{{asset:js:nopage}}"></script>\n');
    await assert.rejects(() => runBuild({ repoRoot, siteDir }), /nopage/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
