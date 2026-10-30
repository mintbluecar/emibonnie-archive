// @ts-check
/**
 * End-to-end bundling: esbuild output + manifest.json, self-hosted font
 * files, and the pages built from their templates, all driven through the real
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
import { buildAppCss } from '../../scripts/buildAssets.js';

/**
 * A temp repo root with `src/`, the solluna example as `site/`, and one
 * fixture page (`public/js/pages/home.js` + the template
 * `src/html/index.html` with asset placeholders, in place of the engine's
 * own pages), so `runBuild` bundles something real.
 * @returns {{ repoRoot: string, siteDir: string }}
 */
function makeBundlingRepoRoot() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fan-archive-bundle-'));
  cpSync('src', path.join(repoRoot, 'src'), { recursive: true });
  rmSync(path.join(repoRoot, 'src/html'), { recursive: true, force: true });
  cpSync('examples/solluna', path.join(repoRoot, 'site'), { recursive: true });
  cpSync('robots.txt', path.join(repoRoot, 'robots.txt'));

  mkdirSync(path.join(repoRoot, 'public/js/pages'), { recursive: true });
  writeFileSync(path.join(repoRoot, 'public/js/pages/home.js'), "export function start() { console.log('home'); }\n");

  mkdirSync(path.join(repoRoot, 'src/html'), { recursive: true });
  writeFileSync(
    path.join(repoRoot, 'src/html/index.html'),
    '<!doctype html>\n<html lang="en"><head>\n' +
      '<link rel="stylesheet" href="{{asset:app.css}}">\n' +
      '<link rel="stylesheet" href="{{asset:fonts.css}}">\n' +
      '</head><body>\n<script type="module" src="{{asset:js:home}}"></script>\n</body></html>\n',
  );

  return { repoRoot, siteDir: path.join(repoRoot, 'site') };
}

test('runBuild: bundles one page, writes a manifest, and writes the page from its template with placeholders resolved', async () => {
  const { repoRoot, siteDir } = makeBundlingRepoRoot();
  try {
    const template = readFileSync(path.join(repoRoot, 'src/html/index.html'), 'utf8');
    await runBuild({ repoRoot, siteDir });
    assert.equal(readFileSync(path.join(repoRoot, 'src/html/index.html'), 'utf8'), template, 'the tracked template is never rewritten (Task 9a item 8)');

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
      assert.match(file, /-(400|600|700|800)-normal-[0-9a-f]{10}\.woff2$/);
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

test('runBuild: every font file is content-hashed, and every fonts.css url resolves to one that exists', async () => {
  const { repoRoot, siteDir } = makeBundlingRepoRoot();
  try {
    await runBuild({ repoRoot, siteDir });
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'public/build/manifest.json'), 'utf8'));
    const fontsDir = path.join(repoRoot, 'public/build/fonts');
    const files = readdirSync(fontsDir);
    assert.ok(files.length > 0);
    for (const file of files) assert.match(file, /-[0-9a-f]{10}\.woff2$/, `${file} carries a content hash`);

    const fontsCss = readFileSync(path.join(repoRoot, 'public/build', manifest.fontsCss), 'utf8');
    const urls = [...fontsCss.matchAll(/url\('\.\/fonts\/([^']+)'\)/g)].map((m) => m[1]);
    assert.ok(urls.length > 0, 'fonts.css declares at least one @font-face src url');
    for (const fileName of urls) {
      assert.ok(existsSync(path.join(fontsDir, fileName)), `fonts.css references ${fileName}, which must exist on disk`);
    }
    // every referenced file is also one of the ones actually copied (no stray/unhashed leftovers)
    assert.deepEqual([...urls].sort(), [...files].sort());
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
    rmSync(path.join(repoRoot, 'src/html'), { recursive: true, force: true });
    cpSync('examples/solluna', path.join(repoRoot, 'site'), { recursive: true });
    cpSync('robots.txt', path.join(repoRoot, 'robots.txt'));

    await runBuild({ repoRoot, siteDir: path.join(repoRoot, 'site') });

    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'public/build/manifest.json'), 'utf8'));
    assert.deepEqual(manifest.pages, {});
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runBuild: a rebuild writes the page again from its unchanged template, with the new hash', async () => {
  const { repoRoot, siteDir } = makeBundlingRepoRoot();
  try {
    await runBuild({ repoRoot, siteDir });
    const firstManifest = JSON.parse(readFileSync(path.join(repoRoot, 'public/build/manifest.json'), 'utf8'));

    // A source change that changes the page's bundled JS (so its hash changes), simulating a second `npm run dev` cycle.
    writeFileSync(path.join(repoRoot, 'public/js/pages/home.js'), "export function start() { console.log('home v2'); }\n");
    await runBuild({ repoRoot, siteDir });
    const secondManifest = JSON.parse(readFileSync(path.join(repoRoot, 'public/build/manifest.json'), 'utf8'));
    assert.notEqual(secondManifest.pages.home, firstManifest.pages.home, 'the hash did change');

    const html = readFileSync(path.join(repoRoot, 'public/index.html'), 'utf8');
    assert.ok(html.includes(`/build/${secondManifest.pages.home}`), 'the built page has the new hash');
    assert.ok(!html.includes(firstManifest.pages.home), 'the stale hash is gone, not left dangling');
    assert.ok(existsSync(path.join(repoRoot, 'public/build', secondManifest.pages.home)), 'and the file it now points to actually exists');
    assert.match(readFileSync(path.join(repoRoot, 'src/html/index.html'), 'utf8'), /\{\{asset:js:home\}\}/, 'the template keeps its placeholder');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runBuild: a built page whose template is gone is removed from public/', async () => {
  const { repoRoot, siteDir } = makeBundlingRepoRoot();
  try {
    writeFileSync(path.join(repoRoot, 'public/old-page.html'), '<p>stale</p>\n');
    await runBuild({ repoRoot, siteDir });
    assert.ok(!existsSync(path.join(repoRoot, 'public/old-page.html')));
    assert.ok(existsSync(path.join(repoRoot, 'public/index.html')));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('runBuild: an unresolved asset placeholder fails the build loudly', async () => {
  const { repoRoot, siteDir } = makeBundlingRepoRoot();
  try {
    writeFileSync(path.join(repoRoot, 'src/html/broken.html'), '<script type="module" src="{{asset:js:nopage}}"></script>\n');
    await assert.rejects(() => runBuild({ repoRoot, siteDir }), /nopage/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

/**
 * A temp repo root with one `src/styles/*` source per cascade layer --
 * `tokens.css`, `base.css`, `primitives/mark.css`, `layout.css`,
 * `components/mark.css` -- each setting a `--marker` custom property to
 * its own folder's name, plus a separate site theme file. Lets a test
 * assert which `@layer` each source landed in without esbuild's minifier
 * rewriting the assertable value (a plain identifier custom-property
 * value survives minification unchanged; a named colour doesn't -- it
 * gets shortened to a hex triplet). Caller must
 * `rmSync(repoRoot, { recursive: true, force: true })`.
 * @returns {{ repoRoot: string, siteThemePath: string }}
 */
function makeLayeredStylesRepoRoot() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fan-archive-layers-'));
  const stylesDir = path.join(repoRoot, 'src/styles');
  mkdirSync(path.join(stylesDir, 'primitives'), { recursive: true });
  mkdirSync(path.join(stylesDir, 'components'), { recursive: true });
  writeFileSync(path.join(stylesDir, 'tokens.css'), ':root { --marker: tokens; }');
  writeFileSync(path.join(stylesDir, 'base.css'), ':root { --marker: base; }');
  writeFileSync(path.join(stylesDir, 'primitives/mark.css'), ':root { --marker: primitives; }');
  writeFileSync(path.join(stylesDir, 'layout.css'), ':root { --marker: layout; }');
  writeFileSync(path.join(stylesDir, 'components/mark.css'), ':root { --marker: components; }');
  const siteThemePath = path.join(repoRoot, 'theme.css');
  writeFileSync(siteThemePath, ':root { --color-bg: #f6efe3; }');
  return { repoRoot, siteThemePath };
}

test('buildAppCss: app.css declares the layer order once, first', () => {
  const { repoRoot, siteThemePath } = makeLayeredStylesRepoRoot();
  const outDir = mkdtempSync(path.join(tmpdir(), 'fan-archive-layers-out-'));
  try {
    const fileName = buildAppCss(repoRoot, outDir, siteThemePath);
    const css = readFileSync(path.join(outDir, fileName), 'utf8');
    assert.ok(css.startsWith('@layer tokens,theme,base,primitives,layout,components;'), css.slice(0, 80));
    assert.equal(
      [...css.matchAll(/@layer tokens,theme,base,primitives,layout,components;/g)].length,
      1,
      'the order statement appears exactly once',
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('buildAppCss: each source lands in its layer', () => {
  const { repoRoot, siteThemePath } = makeLayeredStylesRepoRoot();
  const outDir = mkdtempSync(path.join(tmpdir(), 'fan-archive-layers-out-'));
  try {
    const fileName = buildAppCss(repoRoot, outDir, siteThemePath);
    const css = readFileSync(path.join(outDir, fileName), 'utf8');
    for (const [layer, rule] of [
      ['tokens', ':root{--marker: tokens}'],
      ['base', ':root{--marker: base}'],
      ['primitives', ':root{--marker: primitives}'],
      ['layout', ':root{--marker: layout}'],
      ['components', ':root{--marker: components}'],
      ['theme', ':root{--color-bg: #f6efe3}'],
    ]) {
      assert.ok(css.includes(`@layer ${layer}{${rule}}`), `expected @layer ${layer}{${rule}} in ${css}`);
    }
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('buildAppCss: a hand-written @layer in a source fails the build, naming the file', () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fan-archive-layers-bad-'));
  const stylesDir = path.join(repoRoot, 'src/styles');
  mkdirSync(stylesDir, { recursive: true });
  const basePath = path.join(stylesDir, 'base.css');
  writeFileSync(path.join(stylesDir, 'tokens.css'), ':root { --marker: tokens; }');
  writeFileSync(basePath, '@layer evil { button { color: red; } }');
  writeFileSync(path.join(stylesDir, 'layout.css'), '.container {}');
  const outDir = mkdtempSync(path.join(tmpdir(), 'fan-archive-layers-bad-out-'));
  try {
    assert.throws(() => buildAppCss(repoRoot, outDir, null), new RegExp(basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('buildAppCss: the site theme is layered, never unlayered', () => {
  const { repoRoot, siteThemePath } = makeLayeredStylesRepoRoot();
  const outDir = mkdtempSync(path.join(tmpdir(), 'fan-archive-layers-out-'));
  try {
    const fileName = buildAppCss(repoRoot, outDir, siteThemePath);
    const css = readFileSync(path.join(outDir, fileName), 'utf8');
    assert.ok(css.includes('@layer theme{:root{--color-bg: #f6efe3}}'), css);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('type scale (Task 10b): every font size in src/styles is a --text-* token (none hard-coded), and each token is defined in tokens.css with the bump', async () => {
  const { readdirSync, readFileSync: read } = await import('node:fs');
  const stylesDir = new URL('../../src/styles/', import.meta.url);
  const files = [...readdirSync(stylesDir).filter((f) => f.endsWith('.css')).map((f) => new URL(f, stylesDir)),
    ...readdirSync(new URL('components/', stylesDir)).filter((f) => f.endsWith('.css')).map((f) => new URL(`components/${f}`, stylesDir)),
    ...readdirSync(new URL('primitives/', stylesDir)).filter((f) => f.endsWith('.css')).map((f) => new URL(`primitives/${f}`, stylesDir))];
  const tokens = read(new URL('tokens.css', stylesDir), 'utf8');
  assert.match(tokens, /--text-bump: 2px;/);
  for (const file of files) {
    for (const [, value] of read(file, 'utf8').matchAll(/font-size:\s*([^;]+);/g)) {
      const token = /^var\((--text-[\w-]+)\)$/.exec(value.trim())?.[1];
      assert.ok(token, `${file.pathname.split('/styles/')[1]}: font-size ${value} is not a --text-* token`);
      assert.match(tokens, new RegExp(`${token}: calc\\([\\d.]+px \\+ var\\(--text-bump\\)\\);`), token);
    }
  }
});
