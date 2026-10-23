// @ts-check
/**
 * Offline tests for `site/scripts/deploy.sh`, run entirely through its
 * `--dry-run` flag: no network call, no git/vercel/npm command, and no
 * database connection. Run with `node --test site/test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEPLOY_SH = path.join(REPO_ROOT, 'site/scripts/deploy.sh');

const PREVIEW_URL = 'postgres://preview-user:preview-secret-token@ep-preview.example.neon.tech/db';
const PROD_URL = 'postgres://prod-user:prod-secret-token@ep-main.example.neon.tech/db';

/**
 * Runs `site/scripts/deploy.sh` with the given args and env, always under
 * `--dry-run`, and returns combined stdout+stderr.
 * @param {string[]} args
 * @param {Record<string, string>} env
 * @returns {{ status: number, output: string }}
 */
function runDryRun(args, env) {
  try {
    const output = execFileSync('bash', [DEPLOY_SH, ...args, '--dry-run'], {
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
  assert.doesNotMatch(output, /step 1/);
});

test('refuses when the needed production env var is empty, before printing any step', () => {
  const { status, output } = runDryRun(['--prod'], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.notEqual(status, 0);
  assert.match(output, /EMIBONNIE_DB is not set/);
  assert.doesNotMatch(output, /step 1/);
});

test('preview dry run prints every step in order, deploying without --prod', () => {
  const { status, output } = runDryRun([], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.equal(status, 0);
  const order = [
    'env check',
    '.vercel/project.json',
    'rm -rf .vercel/output',
    'npm ci',
    'npm run build',
    'npm run check',
    'npm test',
    'node --test site/test/',
    'npm run e2e:site',
    'npm run doctor',
    'npm run migrate',
    'site/scripts/check-app-role.sh',
    'vercel pull --yes --environment=preview',
    'vercel build',
    'vercel deploy --prebuilt',
    'deployment URL',
  ];
  let cursor = -1;
  for (const marker of order) {
    const at = output.indexOf(marker);
    assert.ok(at !== -1, `expected to find '${marker}' in:\n${output}`);
    assert.ok(at > cursor, `expected '${marker}' after the previous step, got:\n${output}`);
    cursor = at;
  }
  // A preview run never asks for a typed confirmation, never selects --prod,
  // and check-app-role is called with no --prod flag.
  assert.doesNotMatch(output, /typed confirmation/);
  assert.doesNotMatch(output, /vercel build --prod/);
  assert.doesNotMatch(output, /vercel deploy --prebuilt --prod/);
  assert.doesNotMatch(output, /environment=production/);
  assert.doesNotMatch(output, /check-app-role\.sh --prod/);
  // Preview mode warns that a brand-new project's first deploy is always production.
  assert.match(output, /FIRST deployment is always production/);
});

test('--prod dry run selects the production target, environment, confirmation, and the least-privilege check, all with production flags', () => {
  const { status, output } = runDryRun(['--prod'], { EMIBONNIE_DB: PROD_URL });
  assert.equal(status, 0);
  assert.match(output, /target: production/);
  assert.match(output, /environment=production/);
  assert.match(output, /vercel build --prod/);
  assert.match(output, /vercel deploy --prebuilt --prod/);
  assert.match(output, /typed confirmation \('yes, migrate production'\)/);
  assert.match(output, /check-app-role\.sh --prod/);
  // No preview-only "first deploy" reminder when --prod is already selected.
  assert.doesNotMatch(output, /FIRST deployment is always production/);

  // Full order, fix round 1 M6: doctor, then the confirmation, migrate, the
  // least-privilege check, then pull, build and deploy -- all for production.
  const order = [
    'npm run doctor',
    "would ask for typed confirmation ('yes, migrate production')",
    'npm run migrate',
    'site/scripts/check-app-role.sh --prod',
    'vercel pull --yes --environment=production',
    'vercel build --prod',
    'vercel deploy --prebuilt --prod',
  ];
  let cursor = -1;
  for (const marker of order) {
    const at = output.indexOf(marker);
    assert.ok(at !== -1, `expected to find '${marker}' in:\n${output}`);
    assert.ok(at > cursor, `expected '${marker}' after the previous step, got:\n${output}`);
    cursor = at;
  }
});

test('never prints a database URL, in preview or production', () => {
  for (const [args, env] of /** @type {[string[], Record<string,string>][]} */ ([
    [[], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL }],
    [['--prod'], { EMIBONNIE_DB: PROD_URL }],
  ])) {
    const { output } = runDryRun(args, env);
    assert.doesNotMatch(output, /preview-secret-token/);
    assert.doesNotMatch(output, /prod-secret-token/);
    assert.doesNotMatch(output, /postgres:\/\//);
    assert.match(output, /<redacted>/);
  }
});

test('the three database env vars are unset for every later step (fix round 1, I1)', () => {
  const { status, output } = runDryRun([], {
    EMIBONNIE_DB_PREVIEW: PREVIEW_URL,
    EMIBONNIE_DB: PROD_URL,
    DATABASE_URL: 'postgres://decoy-should-be-unset@host/db',
  });
  assert.equal(status, 0);
  assert.match(output, /env check: EMIBONNIE_DB\/EMIBONNIE_DB_PREVIEW\/DATABASE_URL remaining in this process's environment: 0/);
  assert.doesNotMatch(output, /decoy-should-be-unset/);
});

test('rejects an unknown argument before doing anything', () => {
  const { status, output } = runDryRun(['--nonsense'], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.notEqual(status, 0);
  assert.match(output, /unknown argument/);
});
