// @ts-check
/**
 * `npm run screens [-- --db <dir>] [-- --out <dir>] [-- --only <substring>]`
 * (Styling system Task 7, spec section 7 "Screen gallery"): a gallery of
 * every page for every role, for people to look at next to a mockup --
 * never a pass/fail test, and never printed: only counts and the index
 * path.
 *
 * Builds `SITE_DIR` (default: the bundled example under `examples/`,
 * found at runtime by `findExampleDir` like `scripts/initSite.js` --
 * engine code never names it, or `test/purity.test.js` fails; the engine
 * stays fandom-neutral by default, same as the engine smoke's own e2e
 * run), then serves it. Without `--db`, seeds a fresh temp PGlite from
 * the site's `seed/` (as `scripts/e2eSite.js` does) and never touches
 * `.devdb`; with `--db <dir>`, that directory is used as-is (read-mostly:
 * signing in writes a user and a session) -- a site's own
 * `site/Taskfile.yml` points this at `.devdb`.
 *
 * Every page is screenshotted for each role (owner, translator, member,
 * guest) at 390x900 and 1280x900, light and dark (`colorScheme`, the same
 * way the e2e dark projects force it -- e2e/helpers.js's `PROJECTS`), into
 * `--out` (default `.screens/`, gitignored): `<role>/<width>-<theme>/<name>.png`,
 * plus a static `index.html` linking them all, grouped by page then role.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { acquireE2eLock, releaseE2eLock, E2E_LOCK_PATH } from './e2eLock.js';
import { stubSyntheticMedia, gotoReady, e2eLockToken } from './devServerHelpers.js';
import { pagesFor, outPathFor, importJobUrls, buildIndexHtml } from './screensPages.js';
import { findExampleDir } from './initSite.js';

export { pagesFor, outPathFor };

/** The gallery's four roles (no `google`: it's just another sign-in provider for `member`'s own flow). */
const ROLES = /** @type {const} */ (['owner', 'translator', 'member', 'guest']);
const VIEWPORTS = [{ width: 390, height: 900 }, { width: 1280, height: 900 }];
const THEMES = /** @type {const} */ (['light', 'dark']);

/**
 * Runs `node <script>` with `env` layered over this process's own,
 * resolving `true` on exit 0.
 * @param {string} script @param {Record<string, string>} env
 * @returns {Promise<boolean>}
 */
function runOnce(script, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ...env } });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

/**
 * Starts `scripts/dev.js`, kept running until `stopDevServer` stops it --
 * the same direct child-process pattern scripts/devWatch.js uses, no shell.
 * @param {Record<string, string>} env
 * @returns {import('node:child_process').ChildProcess}
 */
function startDevServer(env) {
  return spawn(process.execPath, ['scripts/dev.js'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, ...env } });
}

/** @param {import('node:child_process').ChildProcess|null} child @returns {Promise<void>} */
async function stopDevServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

/** @param {string} url @param {number} timeoutMs @returns {Promise<void>} */
async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`screens: the dev server never answered ${url} within ${timeoutMs}ms`);
}

/**
 * POSTs `urls` to the dev-only `POST /api/dev/import` from `page` (fix
 * round 1, controller ruling) -- its write check (src/http/origin.js)
 * accepts a same-origin page's own `fetch`, unlike Node's own `fetch`,
 * which carries no `Origin` header at all and is refused like a
 * cross-site POST would be (the e2e suite's own pattern,
 * e2e/import.spec.js's `seedJob`).
 * @param {import('playwright').Page} page @param {string[]} urls
 * @returns {Promise<void>}
 */
async function seedImportJob(page, urls) {
  const status = await page.evaluate(async (body) => {
    const res = await fetch('/api/dev/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res.status;
  }, { urls });
  if (status !== 200) console.error(`screens: seeding an import job failed (${status})`);
}

/**
 * The page list for `role`, plus the signed-in storage state to reuse for
 * its screenshot contexts (guest: no sign-in, no storage state). Signs in
 * through the dev-only GET route (Task 0), which redirects back to `/`;
 * for owner, that same page also seeds one import job first when
 * `importUrls` is given (not `null`: `run.seed` was true and the site had
 * tweet ids to seed from -- `importJobUrls`, scripts/screensPages.js).
 * @param {{ browser: import('playwright').Browser, baseUrl: string, role: 'owner'|'translator'|'member'|'guest', importUrls: string[]|null }} input
 * @returns {Promise<{ pages: {name: string, path: string}[], storageState: any }>}
 */
async function discoverPages({ browser, baseUrl, role, importUrls }) {
  const context = await browser.newContext({ baseURL: baseUrl });
  try {
    if (role !== 'guest') {
      const page = await context.newPage();
      await stubSyntheticMedia(page);
      await gotoReady(page, `/api/auth/dev?as=${encodeURIComponent(role)}&returnTo=%2F`);
      if (role === 'owner' && importUrls) await seedImportJob(page, importUrls);
      await page.close();
    }
    const api = async (/** @type {string} */ p) => {
      const res = await context.request.get(p);
      return res.ok() ? res.json() : null;
    };
    const pages = await pagesFor(role, api);
    const storageState = role === 'guest' ? undefined : await context.storageState();
    return { pages, storageState };
  } finally {
    await context.close();
  }
}

/**
 * One role x viewport x theme pass: every page gets a screenshot.
 * @param {{ browser: import('playwright').Browser, baseUrl: string, role: string, viewport: {width: number, height: number},
 *   theme: 'light'|'dark', pages: {name: string, path: string}[], storageState: any, outDir: string }} input
 * @returns {Promise<{role: string, name: string, path: string, width: number, theme: string}[]>}
 */
async function captureRoleVariant({ browser, baseUrl, role, viewport, theme, pages, storageState, outDir }) {
  const context = await browser.newContext({ baseURL: baseUrl, viewport, colorScheme: theme, storageState });
  /** @type {{role: string, name: string, path: string, width: number, theme: string}[]} */
  const shots = [];
  try {
    const page = await context.newPage();
    await stubSyntheticMedia(page);
    for (const entry of pages) {
      await gotoReady(page, entry.path);
      const relPath = outPathFor(role, viewport.width, theme, entry.name);
      mkdirSync(path.dirname(path.join(outDir, relPath)), { recursive: true });
      await page.screenshot({ path: path.join(outDir, relPath), fullPage: true });
      shots.push({ role, name: entry.name, path: relPath, width: viewport.width, theme });
    }
    await page.close();
  } finally {
    await context.close();
  }
  return shots;
}

/**
 * Every role x viewport x theme: one page-discovery pass per role (reused
 * across its four viewport/theme contexts, and where owner's import job
 * is seeded), then a screenshot pass each.
 * @param {{ browser: import('playwright').Browser, baseUrl: string, outDir: string, only: string, importUrls: string[]|null }} input
 * @returns {Promise<{role: string, name: string, path: string, width: number, theme: string}[]>}
 */
async function captureAll({ browser, baseUrl, outDir, only, importUrls }) {
  /** @type {{role: string, name: string, path: string, width: number, theme: string}[]} */
  const shots = [];
  for (const role of ROLES) {
    const { pages, storageState } = await discoverPages({ browser, baseUrl, role, importUrls });
    const filtered = only ? pages.filter((p) => p.path.includes(only)) : pages;
    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        shots.push(...await captureRoleVariant({ browser, baseUrl, role, viewport, theme, pages: filtered, storageState, outDir }));
      }
    }
  }
  return shots;
}

/** @param {string[]} argv @returns {{ db?: string, out: string, only: string }} */
function parseCli(argv) {
  const { values } = parseArgs({ args: argv, options: { db: { type: 'string' }, out: { type: 'string' }, only: { type: 'string' } } });
  return { db: values.db, out: values.out ?? '.screens', only: values.only ?? '' };
}

/**
 * The bundled example's folder under `examples/`, found at runtime
 * (`findExampleDir`, scripts/initSite.js) rather than named here --
 * engine code never names a fandom, even the example's (test/purity.test.js).
 * @returns {string}
 */
function defaultSiteDir() {
  const found = findExampleDir('examples');
  if (!found.ok) throw new Error(`screens: ${found.reason}`);
  return found.dir;
}

/**
 * Resolves the CLI into a run: the site to build (`SITE_DIR`, default the
 * bundled example -- fandom-neutral), the PGlite directory (a fresh temp
 * one unless `--db` gave one), whether that directory needs seeding, and
 * a port for this run's server.
 * @param {{ db?: string, out: string, only: string }} cli
 */
function resolveRun(cli) {
  const dbGiven = Boolean(cli.db);
  return {
    siteDir: process.env.SITE_DIR ?? defaultSiteDir(),
    usedDefaultSite: !process.env.SITE_DIR,
    dbDir: cli.db ?? path.join(tmpdir(), `fan-archive-screens-${randomUUID()}`),
    seed: !dbGiven,
    port: Number(process.env.SCREENS_PORT ?? 4313),
    outDir: cli.out,
    only: cli.only,
  };
}

/**
 * Builds `site/` back, same as e2e/restoreBuild.js: without `SITE_DIR`,
 * this run just built the bundled example into the checkout's build
 * output, so a real `site/` is rebuilt after, or a later `npm run dev` or
 * deploy would be the example's by accident.
 * @param {{ usedDefaultSite: boolean }} run
 * @returns {Promise<void>}
 */
async function restoreSiteBuild({ usedDefaultSite }) {
  if (!usedDefaultSite || !existsSync('site')) return;
  if (await runOnce('scripts/build.js', { SITE_DIR: 'site' })) console.log('screens: rebuilt site/ after the gallery');
}

/**
 * Runs each of `steps` in order, catching any throw or rejection so a
 * later step still runs even when an earlier one fails (fix round 1,
 * review item 1: a server that won't stop must not also leave the build
 * lock held, or every later `npm run screens`/`e2e` run is blocked).
 * Every caught error is reported to stderr once all steps have run;
 * none of them are thrown, so the caller's own error (its `try` block's,
 * if any) is the one that propagates out of its `finally`.
 * @param {(() => Promise<void>|void)[]} steps
 * @returns {Promise<void>}
 */
export async function runCleanup(steps) {
  /** @type {unknown[]} */
  const errors = [];
  for (const step of steps) {
    try {
      await step();
    } catch (/** @type {unknown} */ err) {
      errors.push(err);
    }
  }
  for (const err of errors) console.error('screens: cleanup step failed:', err instanceof Error ? err.message : String(err));
}

async function main() {
  const run = resolveRun(parseCli(process.argv.slice(2)));
  const env = { PORT: String(run.port), PGLITE_DIR: run.dbDir, SITE_DIR: run.siteDir, DATABASE_URL: '', VERCEL: '', DEV_SIGN_IN: '1' };
  const lockToken = e2eLockToken();
  acquireE2eLock(E2E_LOCK_PATH, lockToken);
  /** @type {import('node:child_process').ChildProcess|null} */
  let server = null;
  /** @type {{role: string, name: string, path: string, width: number, theme: string}[]} */
  let shots = [];
  try {
    if (!(await runOnce('scripts/build.js', env))) throw new Error('screens: build failed');
    if (run.seed && !(await runOnce('scripts/seedDev.js', env))) throw new Error('screens: seed-dev failed');
    server = startDevServer(env);
    const baseUrl = `http://127.0.0.1:${run.port}`;
    await waitForServer(baseUrl, 120_000);
    const browser = await chromium.launch();
    try {
      const importUrls = run.seed ? importJobUrls(run.siteDir) : null;
      shots = await captureAll({ browser, baseUrl, outDir: run.outDir, only: run.only, importUrls });
    } finally {
      await browser.close();
    }
  } finally {
    await runCleanup([
      () => stopDevServer(server),
      () => restoreSiteBuild(run),
      () => releaseE2eLock(E2E_LOCK_PATH, lockToken),
      () => { if (run.seed) rmSync(run.dbDir, { recursive: true, force: true }); },
    ]);
  }
  mkdirSync(run.outDir, { recursive: true });
  const indexPath = path.join(run.outDir, 'index.html');
  writeFileSync(indexPath, buildIndexHtml(shots));
  console.log(`screens: ${shots.length} screenshots -> ${indexPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((/** @type {any} */ err) => {
    console.error(err?.message ?? String(err));
    process.exitCode = 1;
  });
}
