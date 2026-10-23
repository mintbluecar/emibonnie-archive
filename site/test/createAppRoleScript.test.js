// @ts-check
/**
 * Offline tests for `site/scripts/create-app-role.sh` (--rotate included),
 * run entirely through its `--dry-run` flag: no `node`-side
 * password/verifier generation, no database connection, no `vercel`
 * command. See site/test/scram.test.js for the SCRAM-SHA-256 verifier
 * itself, checked against a real (local) PGlite database. Run with
 * `node --test site/test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
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

test('preview dry run announces the full order: check existence, generate password, compute verifier, create role, build URL, add to Vercel, fallback', () => {
  const { status, output } = runDryRun([], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.equal(status, 0);
  const order = [
    "role 'app' already exists",
    'generate a strong password',
    'compute its SCRAM-SHA-256 verifier',
    "create role app login password %L",
    'build the app-role URL',
    'vercel env add DATABASE_URL preview --sensitive --yes',
    'chmod 600 file',
  ];
  let cursor = -1;
  for (const marker of order) {
    const at = output.indexOf(marker);
    assert.ok(at !== -1, `expected to find '${marker}' in:\n${output}`);
    assert.ok(at > cursor, `expected '${marker}' after the previous step, got:\n${output}`);
    cursor = at;
  }
  assert.doesNotMatch(output, /DATABASE_URL production/);
  // Fix round 3, C1: never the old (invalid) bind-parameter form.
  assert.doesNotMatch(output, /password \$1/);
  assert.doesNotMatch(output, /vercel env rm/, 'only --rotate removes the existing Secret first');
});

test('--prod dry run targets the production scope', () => {
  const { status, output } = runDryRun(['--prod'], { EMIBONNIE_DB: PROD_URL });
  assert.equal(status, 0);
  assert.match(output, /the production branch/);
  assert.match(output, /vercel env add DATABASE_URL production --sensitive --yes/);
});

test('--rotate dry run requires the role to already exist, uses alter role, and removes the old Vercel Secret first (fix round 3, C1)', () => {
  const { status, output } = runDryRun(['--rotate'], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.equal(status, 0);
  assert.match(output, /would refuse if it doesn't/);
  assert.match(output, /alter role app password %L/);
  assert.doesNotMatch(output, /create role app login password/);
  const order = ['vercel env rm DATABASE_URL preview --yes', 'vercel env add DATABASE_URL preview --sensitive --yes'];
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
  assert.match(output, /vercel env rm DATABASE_URL production --yes/);
  assert.match(output, /vercel env add DATABASE_URL production --sensitive --yes/);
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
