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
 * Rewrites every `public/*.html` page's `{{asset:...}}` placeholders to
 * the manifest's hashed `/build/...` paths, in place.
 * @param {string} publicDir @param {Manifest} manifest
 * @returns {void}
 */
function rewriteHtmlAssets(publicDir, manifest) {
  if (!existsSync(publicDir)) return;
  for (const entry of readdirSync(publicDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const filePath = path.join(publicDir, entry.name);
    const text = readFileSync(filePath, 'utf8');
    const rewritten = text.replace(ASSET_PLACEHOLDER, (_whole, token) => resolveAssetToken(token, manifest));
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
