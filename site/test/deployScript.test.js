// @ts-check
/**
 * Offline tests for `site/scripts/deploy.sh`, run entirely through its
 * `--dry-run` flag: no network call, no git/vercel/npm command, and no
 * database connection. Run with `node --test site/test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
    'failing closed',
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

test('the first-deploy check (fail closed) is announced before step 1, in preview mode only (fix round 3, minor)', () => {
  const { output: previewOutput } = runDryRun([], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  const checkAt = previewOutput.indexOf('failing closed');
  const step1At = previewOutput.indexOf('step 1');
  assert.ok(checkAt !== -1, `expected the fail-closed check to be announced:\n${previewOutput}`);
  assert.ok(checkAt < step1At, `expected the fail-closed check before step 1, got:\n${previewOutput}`);

  const { output: prodOutput } = runDryRun(['--prod'], { EMIBONNIE_DB: PROD_URL });
  assert.doesNotMatch(prodOutput, /failing closed/, '--prod already means production, so there is nothing to detect');
});

test('--prod dry run selects the production target, environment, confirmation, and the least-privilege check, all with production flags', () => {
  const { status, output } = runDryRun(['--prod'], { EMIBONNIE_DB: PROD_URL });
  assert.equal(status, 0);
  assert.match(output, /target: production/);
  assert.match(output, /environment=production/);
  assert.match(output, /vercel build --prod/);
  assert.match(output, /vercel deploy --prebuilt --prod/);
  assert.match(output, /would ask for confirmation \('yes'\) before any step runs/);
  assert.match(output, /check-app-role\.sh --prod/);
  // No preview-only "first deploy" reminder when --prod is already selected.
  assert.doesNotMatch(output, /FIRST deployment is always production/);

  // Full order: the confirmation first (before any check, so a typo costs
  // nothing), then npm ci, doctor, migrate, the least-privilege check, then
  // pull, build and deploy -- all for production.
  const order = [
    "would ask for confirmation ('yes') before any step runs",
    'npm ci',
    'npm run doctor',
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

/**
 * Fix round 4, N3: the real (non-dry-run) first-deploy check, against a
 * scratch copy of deploy.sh (REPO_ROOT resolves to the scratch dir, which
 * gets its own `.vercel/project.json`), a fake `npx` that plays `vercel
 * list`, and a fake `npm` that records its argv and fails -- so a run that
 * gets past the check stops at step 1 (`npm ci`) and nothing real runs.
 * @param {{ listOutput: string, listToStderr?: boolean, listStatus?: number }} fake
 */
function runFirstDeployCheck({ listOutput, listToStderr = false, listStatus = 0 }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fan-archive-deploy-'));
  try {
    mkdirSync(path.join(dir, 'site/scripts'), { recursive: true });
    mkdirSync(path.join(dir, '.vercel'));
    writeFileSync(path.join(dir, '.vercel/project.json'), '{}');
    copyFileSync(DEPLOY_SH, path.join(dir, 'site/scripts/deploy.sh'));
    const binDir = path.join(dir, 'bin');
    mkdirSync(binDir);
    writeFileSync(path.join(dir, 'list-output'), listOutput);
    writeFileSync(path.join(binDir, 'npx'),
      `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${dir}/npx-args"\ncat "${dir}/list-output" ${listToStderr ? '>&2' : ''}\nexit ${listStatus}\n`);
    writeFileSync(path.join(binDir, 'npm'), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${dir}/npm-args"\nexit 1\n`);
    chmodSync(path.join(binDir, 'npx'), 0o755);
    chmodSync(path.join(binDir, 'npm'), 0o755);
    let status = 0;
    let output = '';
    try {
      output = execFileSync('bash', [path.join(dir, 'site/scripts/deploy.sh')], {
        cwd: dir,
        env: { PATH: `${binDir}:${process.env.PATH ?? ''}`, EMIBONNIE_DB_PREVIEW: PREVIEW_URL },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (/** @type {any} */ err) {
      status = err.status ?? 1;
      output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    const read = (/** @type {string} */ f) => (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), 'utf8') : '');
    return { status, output, npxArgs: read('npx-args'), npmArgs: read('npm-args') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const [label, fake, why] of /** @type {[string, Parameters<typeof runFirstDeployCheck>[0], RegExp][]} */ ([
  ['empty output', { listOutput: '' }, /showed no deployment URL/],
  ['"No deployments found."', { listOutput: 'Vercel CLI 65.1.0\n> No deployments found.\n', listToStderr: true }, /showed no deployment URL/],
  ['unfamiliar wording, exit 0', { listOutput: 'Something changed in this CLI version\n' }, /showed no deployment URL/],
  ['an error', { listOutput: 'Error: Not authorized\n', listToStderr: true, listStatus: 1 }, /'vercel list' failed \(exit 1\)/],
])) {
  test(`first-deploy check stops on ${label}, before step 1 (fix round 4, N3)`, () => {
    const r = runFirstDeployCheck(fake);
    assert.notEqual(r.status, 0, r.output);
    assert.equal(r.npxArgs, '--yes vercel@65.1.0 list\n');
    assert.match(r.output, why);
    assert.match(r.output, /task deploy:prod/);
    assert.equal(r.npmArgs, '', 'nothing after the check may run');
    assert.doesNotMatch(r.output, /preview-secret-token/);
  });
}

for (const toStderr of [false, true]) {
  test(`first-deploy check proceeds when 'vercel list' shows a deployment URL (on ${toStderr ? 'stderr' : 'stdout'})`, () => {
    const r = runFirstDeployCheck({
      listOutput: 'Vercel CLI 65.1.0\n  Age  Deployment                                   Status\n  2d   https://archive-abc123-fanteam.vercel.app      ● Ready\n',
      listToStderr: toStderr,
    });
    assert.match(r.output, /confirmed: this project already has at least one deployment/);
    assert.equal(r.npmArgs, 'ci\n', 'it should reach step 1 (the fake npm then stops it)');
  });
}

test('--prod asks before any step: a typo asks again, and "no" stops with nothing run', () => {
  let output = '';
  let status = 0;
  try {
    output = execFileSync('bash', [DEPLOY_SH, '--prod'], {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH ?? '', EMIBONNIE_DB: PROD_URL },
      encoding: 'utf8',
      input: 'yse\nno\n',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (/** @type {any} */ err) {
    status = err.status ?? 1;
    output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  assert.equal(status, 1);
  assert.match(output, /please type 'yes' or 'no'/);
  assert.match(output, /not confirmed -- stopping before any step runs/);
  assert.doesNotMatch(output, /step 1: running/);
  assert.doesNotMatch(output, /prod-secret-token/);
});
