// @ts-check
/**
 * esbuild's half of the bundling step: one hashed JS bundle per
 * `public/js/pages/<page>.js`, tied together with `scripts/buildAssets.js`'s
 * `app.css`/`fonts.css` into `public/build/manifest.json`, then writing
 * each `src/html/*.html` page template to `public/` with its asset
 * placeholders resolved from it.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { buildAppCss, buildFontsCss } from './buildAssets.js';

/** @typedef {{ file: string, type: string }} Favicon */
/** @typedef {{ appCss: string, fontsCss: string, pages: Record<string, string>, boot: string|null, favicon?: Favicon|null }} Manifest */

const FAVICON_TYPES = /** @type {Record<string, string>} */ ({ '.png': 'image/png', '.svg': 'image/svg+xml' });

/**
 * The site's favicon (Task 10c, j) copied into `outDir` content-hashed
 * (`favicon-<hash>.<ext>`), so it's served from `/build/` with the
 * immutable cache like every other build file. `null` with no source.
 * @param {string|null} src @param {string} outDir
 * @returns {Favicon|null}
 */
function copyFavicon(src, outDir) {
  if (!src) return null;
  const ext = path.extname(src).toLowerCase();
  const type = FAVICON_TYPES[ext];
  if (!type) throw new Error(`build failed: the favicon must be a .png or .svg file, got ${path.basename(src)}`);
  const hash = createHash('sha256').update(readFileSync(src)).digest('hex').slice(0, 10);
  const file = `favicon-${hash}${ext}`;
  copyFileSync(src, path.join(outDir, file));
  return { file, type };
}

/**
 * `{{asset:icons}}`: the favicon and apple-touch-icon links, or nothing
 * for a site with neither a logo nor a favicon.
 * @param {Manifest} manifest @returns {string}
 */
function iconLinks(manifest) {
  if (!manifest.favicon) return '';
  const href = `/build/${manifest.favicon.file}`;
  return `<link rel="icon" type="${manifest.favicon.type}" href="${href}">\n<link rel="apple-touch-icon" href="${href}">`;
}

/**
 * The blocking `<head>` script (`public/js/boot/theme.js`, Task 10c) as
 * one classic (IIFE) hashed file, `boot-<hash>.js`; `null` when the
 * source is missing.
 * @param {string} repoRoot @param {string} outDir
 * @returns {Promise<string|null>}
 */
async function bundleBoot(repoRoot, outDir) {
  const entry = path.join(repoRoot, 'public/js/boot/theme.js');
  if (!existsSync(entry)) return null;
  const result = await esbuild.build({
    entryPoints: { boot: entry }, bundle: true, format: 'iife', target: ['es2022'], minify: true,
    outdir: outDir, entryNames: '[name]-[hash]', metafile: true, write: true, logLevel: 'silent',
  });
  const [output] = Object.keys(result.metafile.outputs);
  return path.basename(output);
}

/**
 * One esbuild entry point per `public/js/pages/<page>.js` file, or `{}`
 * if that folder doesn't exist yet (true before Plan 1b Task 3 adds the
 * first page).
 * @param {string} repoRoot
 * @returns {Record<string, string>}
 */
function pageEntryPoints(repoRoot) {
  const pagesDir = path.join(repoRoot, 'public/js/pages');
  if (!existsSync(pagesDir)) return {};
  /** @type {Record<string, string>} */
  const entries = {};
  for (const file of readdirSync(pagesDir).filter((f) => f.endsWith('.js')).sort()) {
    entries[path.basename(file, '.js')] = path.join(pagesDir, file);
  }
  return entries;
}

/**
 * Bundles every page entry point to `outDir`, each named `<page>-<hash>.js`.
 * @param {string} repoRoot @param {string} outDir
 * @returns {Promise<Record<string, string>>} page name → its bundled filename
 */
async function bundlePages(repoRoot, outDir) {
  const entryPoints = pageEntryPoints(repoRoot);
  if (Object.keys(entryPoints).length === 0) return {};

  const result = await esbuild.build({
    entryPoints,
    bundle: true,
    format: 'esm',
    target: ['es2022'],
    minify: true,
    outdir: outDir,
    entryNames: '[name]-[hash]',
    metafile: true,
    write: true,
    logLevel: 'silent',
    plugins: [siteJsPlugin(path.join(repoRoot, 'public/site/site.js'))],
  });

  /** @type {Record<string, string>} */
  const pages = {};
  for (const [outputPath, info] of Object.entries(result.metafile.outputs)) {
    if (!info.entryPoint) continue;
    const pageName = path.basename(path.resolve(process.cwd(), info.entryPoint), '.js');
    pages[pageName] = path.basename(path.resolve(process.cwd(), outputPath));
  }
  return pages;
}

/**
 * Resolves the one absolute browser-root import `public/js/core/site.js`
 * uses (`'/site/site.js'`) to the real file on disk -- esbuild's own
 * `alias` option rejects a leading `/` as a package name, so this is a
 * tiny plugin instead.
 * @param {string} sitePath
 * @returns {import('esbuild').Plugin}
 */
function siteJsPlugin(sitePath) {
  return {
    name: 'site-js-absolute-import',
    setup(build) {
      build.onResolve({ filter: /^\/site\/site\.js$/ }, () => ({ path: sitePath }));
    },
  };
}

const ASSET_PLACEHOLDER = /\{\{asset:([a-zA-Z0-9_.:-]+)\}\}/g;

/**
 * The `/build/...` URL for one `{{asset:...}}` token: `app.css`,
 * `fonts.css`, or `js:<page>`. Throws on anything else, so a typo or a
 * page whose bundle didn't build fails the build instead of shipping a
 * literal placeholder.
 * @param {string} token @param {Manifest} manifest
 * @returns {string}
 */
function resolveAssetToken(token, manifest) {
  if (token === 'app.css') return `/build/${manifest.appCss}`;
  if (token === 'fonts.css') return `/build/${manifest.fontsCss}`;
  if (token === 'icons') return iconLinks(manifest);
  if (token === 'boot.js') {
    if (!manifest.boot) throw new Error('build failed: {{asset:boot.js}} has no bundled boot script (no public/js/boot/theme.js?)');
    return `/build/${manifest.boot}`;
  }
  if (token.startsWith('js:')) {
    const page = token.slice('js:'.length);
    const fileName = manifest.pages[page];
    if (!fileName) throw new Error(`build failed: {{asset:js:${page}}} has no bundled page JS (no public/js/pages/${page}.js?)`);
    return `/build/${fileName}`;
  }
  throw new Error(`build failed: unknown asset placeholder {{asset:${token}}}`);
}

/**
 * Resolves every `{{asset:...}}` placeholder in `text` against `manifest`
 * (`resolveAssetToken`) -- the one place a page template's placeholders
 * become real `/build/...` URLs, shared by every page `writeHtmlPages`
 * writes and, Styling system Task 3, `scripts/styleguide.js`'s dev-only
 * style guide page.
 * @param {string} text @param {Manifest} manifest
 * @returns {string}
 */
export function resolveAssetPlaceholders(text, manifest) {
  return text.replace(ASSET_PLACEHOLDER, (_whole, token) => resolveAssetToken(token, manifest));
}

/**
 * Writes every page template (`src/html/*.html`, tracked, with
 * `{{asset:...}}` placeholders) to `public/<name>.html` (generated,
 * gitignored) with its placeholders resolved to the manifest's hashed
 * `/build/...` paths. The sources never change, so a rebuild never
 * touches a tracked file (Task 9a item 8: tracked pages rewritten with
 * new hashes on every build would conflict at every engine upgrade).
 * @param {string} htmlDir @param {string} publicDir @param {Manifest} manifest
 * @returns {void}
 */
function writeHtmlPages(htmlDir, publicDir, manifest) {
  mkdirSync(publicDir, { recursive: true });
  // Every public/*.html is built output: one whose template is gone must not linger.
  for (const stale of readdirSync(publicDir).filter((name) => name.endsWith('.html'))) rmSync(path.join(publicDir, stale));
  if (!existsSync(htmlDir)) return;
  for (const entry of readdirSync(htmlDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const text = readFileSync(path.join(htmlDir, entry.name), 'utf8');
    writeFileSync(path.join(publicDir, entry.name), resolveAssetPlaceholders(text, manifest));
  }
}

/**
 * The whole bundling step: `app.css`, self-hosted fonts, every page's JS,
 * `manifest.json`, then the built HTML pages. `engineRoot` is
 * where `node_modules` (esbuild, @fontsource) actually lives; `repoRoot`
 * is where output goes (the same checkout in production, a temp dir in
 * tests). `siteDir`/`fonts` (Styling system Task 14, spec "2b. Fonts a
 * site can choose") are the site's own folder and its validated
 * `site.json` `fonts` list, so `buildFontsCss` can self-host whichever
 * of them a token actually points at.
 * @param {{ repoRoot: string, engineRoot: string, siteThemePath: string|null, faviconPath?: string|null,
 *   siteDir?: string, fonts?: import('../src/site/schema.js').SiteFont[] }} options
 * @returns {Promise<Manifest>}
 */
export async function runBundling({ repoRoot, engineRoot, siteThemePath, faviconPath = null, siteDir, fonts }) {
  const outDir = path.join(repoRoot, 'public/build');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const appCss = buildAppCss(repoRoot, outDir, siteThemePath);
  const fontsCss = buildFontsCss(engineRoot, outDir, { siteDir, fonts });
  const pages = await bundlePages(repoRoot, outDir);
  const boot = await bundleBoot(repoRoot, outDir);

  /** @type {Manifest} */
  const manifest = { appCss, fontsCss, pages, boot, favicon: copyFavicon(faviconPath, outDir) };
  writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  writeHtmlPages(path.join(repoRoot, 'src/html'), path.join(repoRoot, 'public'), manifest);
  return manifest;
}
