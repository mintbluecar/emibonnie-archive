// @ts-check
/**
 * esbuild's half of the bundling step: one hashed JS bundle per
 * `public/js/pages/<page>.js`, tied together with `scripts/buildAssets.js`'s
 * `app.css`/`fonts.css` into `public/build/manifest.json`, then rewriting
 * each `public/*.html` page's asset placeholders from it.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { buildAppCss, buildFontsCss } from './buildAssets.js';

/** @typedef {{ appCss: string, fontsCss: string, pages: Record<string, string> }} Manifest */

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
  if (token.startsWith('js:')) {
    const page = token.slice('js:'.length);
    const fileName = manifest.pages[page];
    if (!fileName) throw new Error(`build failed: {{asset:js:${page}}} has no bundled page JS (no public/js/pages/${page}.js?)`);
    return `/build/${fileName}`;
  }
  throw new Error(`build failed: unknown asset placeholder {{asset:${token}}}`);
}

/**
 * A `/build/<slot>-<hash>.<ext>` reference already resolved by an
 * earlier build, for one asset slot (`app`, `fonts`, or a page name).
 * `{{asset:...}}` placeholders are consumed the first time a page is
 * built, so a committed page's `public/*.html` carries resolved paths,
 * not placeholders, from then on; without also matching this shape, a
 * later rebuild (e.g. a second `npm run dev`, once the page's bundle
 * hash has changed) would leave the old, now-404ing path in place.
 * @param {string} slot @param {string} ext
 * @returns {RegExp}
 */
function resolvedAssetPattern(slot, ext) {
  return new RegExp(`/build/${slot}-[A-Za-z0-9]+\\.${ext}`, 'g');
}

/**
 * Refreshes any already-resolved `/build/...` reference in `text`, for
 * each of `manifest`'s asset slots, to its current hash.
 * @param {string} text @param {Manifest} manifest
 * @returns {string}
 */
function refreshResolvedAssets(text, manifest) {
  let result = text
    .replace(resolvedAssetPattern('app', 'css'), `/build/${manifest.appCss}`)
    .replace(resolvedAssetPattern('fonts', 'css'), `/build/${manifest.fontsCss}`);
  for (const [page, fileName] of Object.entries(manifest.pages)) {
    result = result.replace(resolvedAssetPattern(page, 'js'), `/build/${fileName}`);
  }
  return result;
}

/**
 * Rewrites every `public/*.html` page's asset references to the
 * manifest's current hashed `/build/...` paths, in place -- whether
 * they're still `{{asset:...}}` placeholders (a page's first build) or
 * already-resolved paths from an earlier one (idempotent: safe to run
 * again and again as bundle hashes change).
 * @param {string} publicDir @param {Manifest} manifest
 * @returns {void}
 */
function rewriteHtmlAssets(publicDir, manifest) {
  if (!existsSync(publicDir)) return;
  for (const entry of readdirSync(publicDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const filePath = path.join(publicDir, entry.name);
    const text = readFileSync(filePath, 'utf8');
    const withPlaceholdersResolved = text.replace(ASSET_PLACEHOLDER, (_whole, token) => resolveAssetToken(token, manifest));
    const rewritten = refreshResolvedAssets(withPlaceholdersResolved, manifest);
    if (rewritten !== text) writeFileSync(filePath, rewritten);
  }
}

/**
 * The whole bundling step: `app.css`, self-hosted fonts, every page's JS,
 * `manifest.json`, then the HTML placeholder rewrite. `engineRoot` is
 * where `node_modules` (esbuild, @fontsource) actually lives; `repoRoot`
 * is where output goes (the same checkout in production, a temp dir in
 * tests).
 * @param {{ repoRoot: string, engineRoot: string, siteThemePath: string|null }} options
 * @returns {Promise<Manifest>}
 */
export async function runBundling({ repoRoot, engineRoot, siteThemePath }) {
  const outDir = path.join(repoRoot, 'public/build');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const appCss = buildAppCss(repoRoot, outDir, siteThemePath);
  const fontsCss = buildFontsCss(engineRoot, outDir);
  const pages = await bundlePages(repoRoot, outDir);

  /** @type {Manifest} */
  const manifest = { appCss, fontsCss, pages };
  writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  rewriteHtmlAssets(path.join(repoRoot, 'public'), manifest);
  return manifest;
}
