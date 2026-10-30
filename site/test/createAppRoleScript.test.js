// @ts-check
/**
 * Offline tests for `site/scripts/create-app-role.sh` (--rotate included),
 * run entirely through its `--dry-run` flag: no `node`-side password
 * generation, no database connection, no `vercel` command. See
 * site/test/appRole.test.js for the role creation itself, checked against
 * a real (local) PGlite database. Run with
 * `node --test site/test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = path.join(REPO_ROOT, 'site/scripts/create-app-role.sh');

const PREVIEW_URL = 'postgres://preview-user:preview-secret-token@ep-preview.example.neon.tech/db';
const PROD_URL = 'postgres://prod-user:prod-secret-token@ep-main.example.neon.tech/db';

/**
 * @param {string[]} args
 * @param {Record<string, string>} env
 * @returns {{ status: number, output: string }}
 */
function runDryRun(args, env) {
  try {
    const output = execFileSync('bash', [SCRIPT, ...args, '--dry-run'], {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH ?? '', ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (/** @type {any} */ err) {
    return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

test('refuses when the needed preview env var is empty, before printing any step', () => {
  const { status, output } = runDryRun([], {});
  assert.notEqual(status, 0);
  assert.match(output, /EMIBONNIE_DB_PREVIEW is not set/);
  assert.doesNotMatch(output, /would check/);
});

test('refuses when the needed production env var is empty, before printing any step', () => {
  const { status, output } = runDryRun(['--prod'], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.notEqual(status, 0);
  assert.match(output, /EMIBONNIE_DB is not set/);
  assert.doesNotMatch(output, /would check/);
});

test('preview dry run announces the full order: check existence, generate password, send it in plaintext over TLS, create role, build URL, add to Vercel, fallback', () => {
  const { status, output } = runDryRun([], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.equal(status, 0);
  const order = [
    "role 'app' already exists",
    'generate a strong password',
    'send that plaintext password to Neon over TLS',
    "create role app login password %L",
    'build the app-role URL',
    'vercel env add DATABASE_URL --environment preview --sensitive --yes',
    'chmod 600 file',
  ];
  let cursor = -1;
  for (const marker of order) {
    const at = output.indexOf(marker);
    assert.ok(at !== -1, `expected to find '${marker}' in:\n${output}`);
    assert.ok(at > cursor, `expected '${marker}' after the previous step, got:\n${output}`);
    cursor = at;
  }
  assert.doesNotMatch(output, /--environment production/);
  // Fix round 3, C1: never the old (invalid) bind-parameter form.
  assert.doesNotMatch(output, /password \$1/);
  // Fix round 5: Neon refuses hashed passwords, so no verifier step.
  assert.doesNotMatch(output, /verifier|never sent to Postgres/i);
  assert.doesNotMatch(output, /vercel env (rm|update)/, 'a first run only ever adds');
  assert.doesNotMatch(output, /redeploy finishes/, 'only --rotate changes a live password');
});

test('--prod dry run targets the production scope', () => {
  const { status, output } = runDryRun(['--prod'], { EMIBONNIE_DB: PROD_URL });
  assert.equal(status, 0);
  assert.match(output, /the production database/);
  assert.match(output, /vercel env add DATABASE_URL --environment production --sensitive --yes/);
});

test('--rotate dry run requires the role to already exist, uses alter role, and updates the Vercel Secret in one step (fix round 4, R1)', () => {
  const { status, output } = runDryRun(['--rotate'], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.equal(status, 0);
  assert.match(output, /refuse if it doesn't/);
  assert.match(output, /alter role app password %L/);
  assert.doesNotMatch(output, /create role app login password/);
  assert.doesNotMatch(output, /vercel env (rm|add)/);
  const order = ['vercel env update DATABASE_URL --environment preview --sensitive --yes', "can't reach the database until a redeploy finishes", 'task deploy:preview'];
  let cursor = -1;
  for (const marker of order) {
    const at = output.indexOf(marker);
    assert.ok(at !== -1, `expected to find '${marker}' in:\n${output}`);
    assert.ok(at > cursor, `expected '${marker}' after the previous step, got:\n${output}`);
    cursor = at;
  }
});

test('--rotate --prod dry run targets the production scope', () => {
  const { status, output } = runDryRun(['--rotate', '--prod'], { EMIBONNIE_DB: PROD_URL });
  assert.equal(status, 0);
  assert.match(output, /vercel env update DATABASE_URL --environment production --sensitive --yes/);
  assert.match(output, /task deploy:prod/);
});

test('never prints a database URL, a password, or the app-role URL', () => {
  for (const [args, env] of /** @type {[string[], Record<string,string>][]} */ ([
    [[], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL }],
    [['--prod'], { EMIBONNIE_DB: PROD_URL }],
  ])) {
    const { output } = runDryRun(args, env);
    assert.doesNotMatch(output, /preview-secret-token/);
    assert.doesNotMatch(output, /prod-secret-token/);
    assert.doesNotMatch(output, /postgres:\/\//);
    assert.match(output, /redacted|never printed/);
  }
});

test('rejects an unknown argument before doing anything', () => {
  const { status, output } = runDryRun(['--nonsense'], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.notEqual(status, 0);
  assert.match(output, /unknown argument/);
});

/**
 * Fix round 4, R1-R3: the real (non-dry-run) Vercel step, run against a
 * scratch copy of the script -- REPO_ROOT resolves to the scratch dir --
 * with a stub `site/scripts/app-role.mjs` (prints a fixed app-role URL,
 * no database) and a fake `npx` first on PATH that records its argv and
 * stdin. HOME is the scratch dir too, so the fallback file lands there.
 */
function makeScratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fan-archive-approle-'));
  mkdirSync(path.join(dir, 'site/scripts'), { recursive: true });
  copyFileSync(SCRIPT, path.join(dir, 'site/scripts/create-app-role.sh'));
  copyFileSync(path.join(REPO_ROOT, 'site/scripts/lib.sh'), path.join(dir, 'site/scripts/lib.sh'));
  writeFileSync(path.join(dir, 'site/scripts/app-role.mjs'),
    'process.stderr.write(process.env.ROTATE === "1" ? "ROLE_ROTATED\\n" : "ROLE_CREATED\\n");\n' +
    'process.stdout.write("postgres://app:STUB-APP-PASSWORD@ep.example.neon.tech/db");\n');
  const binDir = path.join(dir, 'bin');
  mkdirSync(binDir);
  writeFileSync(path.join(binDir, 'npx'),
    '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$HOME/npx-args"\ncat >> "$HOME/npx-stdin"\nexit "${FAKE_NPX_STATUS:-0}"\n');
  chmodSync(path.join(binDir, 'npx'), 0o755);
  return { dir, binDir };
}

/**
 * @param {string[]} args @param {Record<string, string>} env
 * @returns {{ status: number, output: string, dir: string, npxArgs: string, npxStdin: string }}
 */
function runReal(args, env) {
  const { dir, binDir } = makeScratch();
  let status = 0;
  let output = '';
  try {
    output = execFileSync('bash', [path.join(dir, 'site/scripts/create-app-role.sh'), ...args], {
      cwd: dir,
      env: { PATH: `${binDir}:${process.env.PATH ?? ''}`, HOME: dir, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (/** @type {any} */ err) {
    status = err.status ?? 1;
    output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  const read = (/** @type {string} */ f) => (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), 'utf8') : '');
  return { status, output, dir, npxArgs: read('npx-args'), npxStdin: read('npx-stdin') };
}

test('real run, first time: one `env add --environment preview --sensitive --yes`, value on stdin only', () => {
  const r = runReal([], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  try {
    assert.equal(r.status, 0, r.output);
    assert.equal(r.npxArgs, '--yes vercel@65.1.0 env add DATABASE_URL --environment preview --sensitive --yes\n');
    assert.equal(r.npxStdin, 'postgres://app:STUB-APP-PASSWORD@ep.example.neon.tech/db');
    assert.doesNotMatch(r.output, /STUB-APP-PASSWORD|preview-secret-token/);
    assert.doesNotMatch(r.output, /redeploy finishes/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('real run, --rotate --prod: exactly one `env update` (no rm, no add), then the outage warning naming task deploy:prod', () => {
  const r = runReal(['--rotate', '--prod'], { EMIBONNIE_DB: PROD_URL });
  try {
    assert.equal(r.status, 0, r.output);
    assert.equal(r.npxArgs, '--yes vercel@65.1.0 env update DATABASE_URL --environment production --sensitive --yes\n');
    assert.equal(r.npxStdin, 'postgres://app:STUB-APP-PASSWORD@ep.example.neon.tech/db');
    assert.match(r.output, /can't reach the database until a redeploy finishes/);
    assert.match(r.output, /Redeploy straight away: task deploy:prod/);
    assert.doesNotMatch(r.output, /STUB-APP-PASSWORD|prod-secret-token/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('real run, --rotate with Vercel failing: chmod 600 fallback file, "edit the existing DATABASE_URL", and the outage warning', () => {
  const r = runReal(['--rotate'], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL, FAKE_NPX_STATUS: '1' });
  try {
    assert.equal(r.status, 0, r.output);
    const file = path.join(r.dir, '.emibonnie/app-preview.url');
    assert.equal(readFileSync(file, 'utf8'), 'postgres://app:STUB-APP-PASSWORD@ep.example.neon.tech/db');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.match(r.output, /edit the existing DATABASE_URL/);
    assert.match(r.output, /task deploy:preview/);
    assert.doesNotMatch(r.output, /STUB-APP-PASSWORD/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('real run, --target-env-var: never calls Vercel, writes only the chmod 600 file, unsets the named var (fix round 4, R3)', () => {
  const r = runReal(['--target-env-var', 'RESTORE_TARGET_URL'], {
    RESTORE_TARGET_URL: 'postgres://owner:restore-secret-token@ep-restore.example.neon.tech/db',
    EMIBONNIE_DB_PREVIEW: PREVIEW_URL,
  });
  try {
    assert.equal(r.status, 0, r.output);
    assert.equal(r.npxArgs, '', 'Vercel must not be touched');
    const file = path.join(r.dir, '.emibonnie/app-restore_target_url.url');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.match(r.output, /Vercel was not touched/);
    assert.doesNotMatch(r.output, /STUB-APP-PASSWORD|restore-secret-token|preview-secret-token/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test('--target-env-var refuses --prod, a missing name, a bad name, and an empty variable', () => {
  const env = { RESTORE_TARGET_URL: 'postgres://o:p@h/db' };
  assert.match(runDryRun(['--target-env-var', 'RESTORE_TARGET_URL', '--prod'], env).output, /can't be combined/);
  assert.match(runDryRun(['--target-env-var'], env).output, /needs a variable name/);
  assert.match(runDryRun(['--target-env-var', 'X;rm'], env).output, /expects an environment variable name/);
  assert.match(runDryRun(['--target-env-var', 'PATH'], env).output, /is a shell variable/);
  const empty = runDryRun(['--target-env-var', 'NOT_SET_ANYWHERE'], env);
  assert.notEqual(empty.status, 0);
  assert.match(empty.output, /NOT_SET_ANYWHERE is not set/);
});
