// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSite, SiteConfigError } from '../src/site/loadSite.js';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** @typedef {{ symbol: '✓' | '✗' | '·', text: string }} DoctorLine */

/**
 * @param {string} repoRoot
 * @returns {DoctorLine}
 */
function checkNodeVersion(repoRoot) {
  const required = readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8').trim();
  const requiredMajor = Number.parseInt(required, 10);
  const currentMajor = Number.parseInt(process.versions.node, 10);
  if (currentMajor >= requiredMajor) {
    return { symbol: '✓', text: `node ${process.versions.node} (.nvmrc wants ${required}+)` };
  }
  return { symbol: '✗', text: `node ${process.versions.node} is older than .nvmrc's ${required} — install Node ${required}+` };
}

/**
 * @param {string} siteDirName
 * @param {boolean} siteExists
 * @returns {DoctorLine}
 */
function checkSiteExists(siteDirName, siteExists) {
  if (siteExists) return { symbol: '✓', text: `${siteDirName}/ exists` };
  return { symbol: '✗', text: `${siteDirName}/ missing — run npm run init-site` };
}

/**
 * @param {string} siteDirPath
 * @param {boolean} siteExists
 * @returns {DoctorLine}
 */
function checkSettingsValid(siteDirPath, siteExists) {
  if (!siteExists) return { symbol: '·', text: 'settings — skipped (no site/)' };
  try {
    loadSite(siteDirPath);
    return { symbol: '✓', text: 'settings are valid' };
  } catch (/** @type {any} */ err) {
    const detail = err instanceof SiteConfigError ? err.errors.join('; ') : String(err.message ?? err);
    return { symbol: '✗', text: `settings invalid — fix site/site.json: ${detail}` };
  }
}

/**
 * Plan 2 builds the migrations runner; until then this is a neutral skip.
 * @param {string} repoRoot
 * @returns {DoctorLine}
 */
function checkMigrations(repoRoot) {
  if (!existsSync(path.join(repoRoot, 'src/db/migrate.js'))) {
    return { symbol: '·', text: 'pending migrations — skipped (migrations not implemented yet)' };
  }
  return { symbol: '·', text: 'pending migrations — skipped (run npm run migrate to check)' };
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {DoctorLine}
 */
function checkEnvVars(env) {
  const required = ['DATABASE_URL'];
  const missing = required.filter((name) => !env[name]);
  if (missing.length === 0) return { symbol: '✓', text: `env vars present (${required.join(', ')})` };
  return { symbol: '✗', text: `missing env var(s): ${missing.join(', ')} — set them in your .env file` };
}

const SEMVER_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** @param {string} tag @returns {number[]} */
const versionOf = (tag) => (SEMVER_TAG.exec(tag) ?? []).slice(1).map(Number);

/** @param {string} a @param {string} b @returns {number} negative when a is older */
function compareVersions(a, b) {
  const [x, y] = [versionOf(a), versionOf(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/**
 * The newest `vX.Y.Z` tag in `git ls-remote --tags` output, or null.
 * An annotated tag is listed twice: as `refs/tags/<tag>` and as the
 * peeled `refs/tags/<tag>^{}` -- the commit it points at (git-ls-remote
 * docs, "OUTPUT": https://git-scm.com/docs/git-ls-remote; the `^{}`
 * suffix, "dereference the tag recursively until a non-tag object is
 * found", is gitrevisions' notation: https://git-scm.com/docs/gitrevisions).
 * So `^{}` is stripped and the names deduped; non-semver tags are ignored,
 * and the order git printed them in is never relied on.
 * @param {string} tagsOutput
 * @returns {string|null}
 */
export function latestTagOf(tagsOutput) {
  const names = tagsOutput.split('\n')
    .map((line) => line.split('refs/tags/')[1]?.trim().replace(/\^\{\}$/, ''))
    .filter((name) => name !== undefined && SEMVER_TAG.test(name));
  const tags = [...new Set(/** @type {string[]} */ (names))].sort(compareVersions);
  return tags.at(-1) ?? null;
}

/**
 * @param {string} tagsOutput
 * @param {string} repoRoot
 * @returns {DoctorLine}
 */
export function compareUpstreamVersion(tagsOutput, repoRoot) {
  const latestTag = latestTagOf(tagsOutput);
  if (!latestTag) return { symbol: '·', text: 'engine version — skipped (upstream has no vX.Y.Z tags)' };
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const localVersion = `v${pkg.version}`;
  if (localVersion === latestTag) return { symbol: '✓', text: `engine version ${localVersion} matches upstream` };
  if (SEMVER_TAG.test(localVersion) && compareVersions(localVersion, latestTag) > 0) {
    return { symbol: '✓', text: `engine version ${localVersion} is ahead of upstream's ${latestTag}` };
  }
  return {
    symbol: '✗',
    text: `engine version ${localVersion} is behind upstream ${latestTag} — git fetch upstream --tags && git merge ${latestTag}, ` +
      "then follow that release's upgrade steps in CHANGELOG.md",
  };
}

/**
 * Only runs if the `upstream` remote exists and is reachable; otherwise a
 * neutral skip, never a ✗.
 * @param {string} repoRoot
 * @returns {DoctorLine}
 */
function checkUpstreamVersion(repoRoot) {
  try {
    execFileSync('git', ['remote', 'get-url', 'upstream'], { cwd: repoRoot, stdio: 'ignore' });
  } catch {
    return { symbol: '·', text: 'engine version — skipped (no upstream remote)' };
  }
  try {
    const tagsOutput = execFileSync('git', ['ls-remote', '--tags', 'upstream'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).toString('utf8');
    return compareUpstreamVersion(tagsOutput, repoRoot);
  } catch {
    return { symbol: '·', text: 'engine version — skipped (upstream unreachable)' };
  }
}

/**
 * Runs every doctor check. `ok` is false when any check is a ✗.
 * @param {{ repoRoot?: string, siteDir?: string, env?: Record<string, string | undefined> }} [options]
 * @returns {{ lines: DoctorLine[], ok: boolean }}
 */
export function runDoctor(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const siteDirName = options.siteDir ?? process.env.SITE_DIR ?? 'site';
  const siteDirPath = path.isAbsolute(siteDirName) ? siteDirName : path.join(repoRoot, siteDirName);
  const env = options.env ?? process.env;
  const siteExists = existsSync(siteDirPath);

  const lines = [
    checkNodeVersion(repoRoot),
    checkSiteExists(siteDirName, siteExists),
    checkSettingsValid(siteDirPath, siteExists),
    checkMigrations(repoRoot),
    checkEnvVars(env),
    checkUpstreamVersion(repoRoot),
  ];
  return { lines, ok: lines.every((line) => line.symbol !== '✗') };
}

function main() {
  const { lines, ok } = runDoctor();
  for (const line of lines) console.log(`${line.symbol} ${line.text}`);
  process.exitCode = ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
