// @ts-check
import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSite } from '../src/site/loadSite.js';
import { loadCopy } from '../src/site/copy.js';
import { walkFiles, findMissingCssTokens, findMissingCopyKeys } from './buildChecks.js';
import {
  buildGeneratedSiteModule,
  buildPublicSiteModule,
  listKindFolders,
  buildKindsRegistryModule,
  buildVercelConfig,
} from './buildOutputs.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Engine CSS that must only reference tokens `src/styles/tokens.css`
 * defines: today, just that file itself, plus `public/css/**` once Plan 1b
 * adds it.
 * @param {string} repoRoot
 * @returns {{ path: string, text: string }[]}
 */
function collectEngineCssSources(repoRoot) {
  return [
    ...walkFiles(path.join(repoRoot, 'src/styles'), '.css'),
    ...walkFiles(path.join(repoRoot, 'public/css'), '.css'),
  ];
}

/**
 * Engine JS that may call `t('key')`: `src/` (excluding generated files),
 * `api/`, and `public/js/`. Build/dev tooling under `scripts/` never
 * renders user-facing copy, so it's out of scope here.
 * @param {string} repoRoot
 * @returns {{ path: string, text: string }[]}
 */
function collectEngineJsSources(repoRoot) {
  const generated = new Set(['src/site/generated.js', 'src/kinds/_registry.js'].map((p) => path.join(repoRoot, p)));
  const sources = [
    ...walkFiles(path.join(repoRoot, 'src'), '.js'),
    ...walkFiles(path.join(repoRoot, 'api'), '.js'),
    ...walkFiles(path.join(repoRoot, 'public/js'), '.js'),
  ];
  return sources.filter((source) => !generated.has(source.path));
}

/**
 * `src/pages.js`'s page rewrites (Plan 1b), or `[]` if the file doesn't
 * exist yet.
 * @param {string} repoRoot
 * @returns {Promise<{ source: string, destination: string }[]>}
 */
async function readPageRewrites(repoRoot) {
  const pagesPath = path.join(repoRoot, 'src/pages.js');
  if (!existsSync(pagesPath)) return [];
  const mod = await import(pathToFileURL(pagesPath).href);
  return mod.pages ?? [];
}

/**
 * `siteDir` may be relative (to `process.cwd()`, as `loadSite` resolves
 * it) or absolute; either way it's used as-is, never re-joined onto
 * `repoRoot`.
 * @param {string} siteDir
 * @param {string} outDir
 * @returns {{ logo: string|null }} the public path of the copied logo, if any
 */
function copySiteAssets(siteDir, outDir) {
  const themeSrc = path.join(siteDir, 'theme.css');
  if (existsSync(themeSrc)) cpSync(themeSrc, path.join(outDir, 'theme.css'));

  for (const ext of ['svg', 'png']) {
    const logoSrc = path.join(siteDir, `logo.${ext}`);
    if (existsSync(logoSrc)) {
      cpSync(logoSrc, path.join(outDir, `logo.${ext}`));
      return { logo: `/site/logo.${ext}` };
    }
  }
  return { logo: null };
}

/**
 * The route table's meta rewrites. Imported from this engine checkout
 * (so its dependencies resolve here) after the kinds registry is written.
 * @returns {Promise<{ source: string, destination: string }[]>}
 */
async function readRouteRewrites() {
  const mod = await import(new URL('../src/routes/index.js', import.meta.url).href);
  return mod.rewrites;
}

/**
 * Builds the site: validates `site.json` and copy, fails on undefined CSS
 * tokens or copy keys, then writes every generated file.
 * @param {{ siteDir?: string, repoRoot?: string }} [options]
 * @returns {Promise<void>}
 */
export async function runBuild(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const siteDir = options.siteDir ?? process.env.SITE_DIR ?? 'site';

  const site = loadSite(siteDir); // throws SiteConfigError on invalid site.json
  const copy = loadCopy(siteDir);

  const tokensCss = readFileSync(path.join(repoRoot, 'src/styles/tokens.css'), 'utf8');
  const missingTokens = findMissingCssTokens(collectEngineCssSources(repoRoot), tokensCss);
  if (missingTokens.length > 0) {
    throw new Error(`build failed: engine CSS uses undefined token(s): ${missingTokens.join(', ')}`);
  }

  const missingCopyKeys = findMissingCopyKeys(collectEngineJsSources(repoRoot), copy);
  if (missingCopyKeys.length > 0) {
    throw new Error(`build failed: code uses undefined copy key(s): ${missingCopyKeys.join(', ')}`);
  }

  const kindsDir = path.join(repoRoot, 'src/kinds');
  mkdirSync(kindsDir, { recursive: true });
  writeFileSync(path.join(kindsDir, '_registry.js'), buildKindsRegistryModule(listKindFolders(kindsDir)));

  const publicSiteDir = path.join(repoRoot, 'public/site');
  mkdirSync(publicSiteDir, { recursive: true });
  writeFileSync(path.join(publicSiteDir, 'site.js'), buildPublicSiteModule(site));
  writeFileSync(path.join(publicSiteDir, 'tokens.css'), tokensCss);
  const assets = copySiteAssets(siteDir, publicSiteDir);

  writeFileSync(path.join(repoRoot, 'src/site/generated.js'), buildGeneratedSiteModule(site, copy, assets));

  const rewrites = [...(await readRouteRewrites()), ...(await readPageRewrites(repoRoot))];
  const vercelConfig = buildVercelConfig(site, rewrites);
  writeFileSync(path.join(repoRoot, 'vercel.json'), `${JSON.stringify(vercelConfig, null, 2)}\n`);
}

async function main() {
  try {
    await runBuild();
    console.log('build: ok');
  } catch (/** @type {any} */ err) {
    console.error(err.message ?? String(err));
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
