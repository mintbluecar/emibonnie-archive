// @ts-check
/**
 * Offline tests for `scripts/deploy.sh`, run entirely through its
 * `--dry-run` flag: no network call, no git/vercel/npm command, and no
 * database connection. Run with `node --test site/test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEPLOY_SH = path.join(REPO_ROOT, 'scripts/deploy.sh');

const PREVIEW_URL = 'postgres://preview-user:preview-secret-token@ep-preview.example.neon.tech/db';
const PROD_URL = 'postgres://prod-user:prod-secret-token@ep-main.example.neon.tech/db';

/**
 * Runs `scripts/deploy.sh` with the given args and env, always under
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

test('preview dry run prints the ten steps in order, deploying without --prod', () => {
  const { status, output } = runDryRun([], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.equal(status, 0);
  const order = [
    'npm ci',
    'npm run build',
    'npm run check',
    'npm test',
    'node --test site/test/',
    'npm run e2e:site',
    'npm run doctor',
    'npm run migrate',
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
  // A preview run never asks for a typed confirmation, and never selects --prod.
  assert.doesNotMatch(output, /typed confirmation/);
  assert.doesNotMatch(output, /vercel build --prod/);
  assert.doesNotMatch(output, /vercel deploy --prebuilt --prod/);
  assert.doesNotMatch(output, /environment=production/);
});

test('--prod dry run selects the production target, environment and typed confirmation', () => {
  const { status, output } = runDryRun(['--prod'], { EMIBONNIE_DB: PROD_URL });
  assert.equal(status, 0);
  assert.match(output, /target: production/);
  assert.match(output, /environment=production/);
  assert.match(output, /vercel build --prod/);
  assert.match(output, /vercel deploy --prebuilt --prod/);
  assert.match(output, /typed confirmation \('yes, migrate production'\)/);
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

test('rejects an unknown argument before doing anything', () => {
  const { status, output } = runDryRun(['--nonsense'], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.notEqual(status, 0);
  assert.match(output, /unknown argument/);
});
