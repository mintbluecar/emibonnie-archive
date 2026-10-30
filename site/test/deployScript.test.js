// @ts-check
/**
 * Offline tests for `site/scripts/deploy.sh`: `--dry-run` runs against this
 * checkout (no network call, no git/vercel/npm command, no database
 * connection), and every real run against a scratch copy with fake `npm`,
 * `npx` (the pinned `vercel`), `curl` and `check-app-role.sh` -- never this
 * checkout. Run with `node --test site/test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
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
    '.vercel/project.json',
    'failing closed',
    'npm ci',
    'npm run build',
    'npm run check',
    'npm test',
    'node --test site/test/',
    'npm run e2e:site',
    'unchanged since the start',
    'vercel pull --yes --environment=preview',
    'vercel build',
    'npm run doctor',
    'npm run migrate',
    'site/scripts/check-app-role.sh',
    'vercel deploy --prebuilt',
    'x-vercel-id',
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
  assert.doesNotMatch(output, /ask for confirmation/);
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

test('--prod dry run builds first, then asks, then migrates and deploys, all with production flags', () => {
  const { status, output } = runDryRun(['--prod'], { EMIBONNIE_DB: PROD_URL });
  assert.equal(status, 0);
  assert.match(output, /target: production/);
  assert.match(output, /environment=production/);
  assert.match(output, /vercel build --prod/);
  assert.match(output, /vercel deploy --prebuilt --prod/);
  assert.match(output, /would run: ask for confirmation \('yes'\)/);
  assert.match(output, /check-app-role\.sh --prod/);
  // No preview-only "first deploy" reminder when --prod is already selected.
  assert.doesNotMatch(output, /FIRST deployment is always production/);

  // Production is touched only after the checks, the tree check, pull and
  // build have all passed and the owner has said yes.
  const order = [
    'npm ci',
    'unchanged since the start',
    'vercel pull --yes --environment=production',
    'vercel build --prod',
    "ask for confirmation ('yes')",
    'npm run doctor',
    'npm run migrate',
    'site/scripts/check-app-role.sh --prod',
    'vercel deploy --prebuilt --prod',
    'x-vercel-id',
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

test('rejects an unknown argument before doing anything', () => {
  const { status, output } = runDryRun(['--nonsense'], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.notEqual(status, 0);
  assert.match(output, /unknown argument/);
});


test('--quick skips the heavy checks but keeps the build, guard, migrate and role check', () => {
  const { status, output } = runDryRun(['--quick'], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.equal(status, 0);
  for (const skipped of ['npm run check', 'npm test', 'npm run e2e:site']) {
    assert.match(output, new RegExp(`skipped \\(--quick\\): ${skipped.replace(/[.:]/g, '\\$&')}`));
  }
  for (const kept of ['would run: npm run build', 'name-leak guard', 'npm run migrate', 'check-app-role.sh', 'unchanged since the start']) {
    assert.ok(output.includes(kept), `expected '${kept}' in:\n${output}`);
  }
  assert.doesNotMatch(output, /preview-secret-token/);
});

test('without --quick no check is skipped', () => {
  const { output } = runDryRun([], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.doesNotMatch(output, /skipped \(--quick\)/);
  assert.match(output, /unchanged since the start/);
});

const LIST_WITH_DEPLOYMENT = 'Vercel CLI 65.1.0\n  Age  Deployment                                   Status\n  2d   https://archive-abc123-fanteam.vercel.app      ● Ready\n';
const DEPLOY_URL = 'https://archive-new123-fanteam.vercel.app';

/**
 * A real (non-dry-run) deploy.sh in a scratch copy: REPO_ROOT resolves to
 * the scratch dir, which gets lib.sh, a `.vercel/project.json`, a
 * `site/site.json` with `"region": "sin1"`, a stale `.vercel/output`, and a
 * stub `site/scripts/check-app-role.sh`. Fake `npm`, `npx` (the pinned
 * `vercel`) and `curl` come first on PATH. Every fake appends one line to
 * `calls`: what ran, plus which database variables it could see (and the
 * DATABASE_URL value, so a test can check it is the right one). Nothing
 * real runs and nothing reaches the network.
 * @param {{
 *   args?: string[], env?: Record<string, string>, input?: string,
 *   listOutput?: string, listToStderr?: boolean, listStatus?: number,
 *   npmFail?: string, buildStatus?: number, vercelId?: string, httpStatus?: string,
 * }} [options]
 */
function runReal({
  args = [], env = { EMIBONNIE_DB_PREVIEW: PREVIEW_URL }, input = '',
  listOutput = LIST_WITH_DEPLOYMENT, listToStderr = false, listStatus = 0,
  npmFail = '', buildStatus = 0, vercelId = 'sin1::sin1::a', httpStatus = '200',
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fan-archive-deploy-'));
  try {
    mkdirSync(path.join(dir, 'site/scripts'), { recursive: true });
    mkdirSync(path.join(dir, '.vercel/output'), { recursive: true });
    writeFileSync(path.join(dir, '.vercel/project.json'), '{}');
    writeFileSync(path.join(dir, '.vercel/output/stale-marker'), 'from an earlier run');
    writeFileSync(path.join(dir, 'site/site.json'), '{ "region": "sin1" }\n');
    copyFileSync(DEPLOY_SH, path.join(dir, 'site/scripts/deploy.sh'));
    copyFileSync(path.join(REPO_ROOT, 'site/scripts/lib.sh'), path.join(dir, 'site/scripts/lib.sh'));
    writeFileSync(path.join(dir, 'list-output'), listOutput);
    const binDir = path.join(dir, 'bin');
    mkdirSync(binDir);
    // Records "<what ran> | <db vars it could see>".
    const record = `seen="$(env | grep -oE '^(EMIBONNIE_DB|EMIBONNIE_DB_PREVIEW|DATABASE_URL)=' | tr -d '=' | sort | tr '\\n' ' ')"
printf '%s | %s%s\\n' "$WHAT" "$seen" "\${DATABASE_URL:+ db=$DATABASE_URL}" >> "${dir}/calls"\n`;
    /** @param {string} file @param {string} body */
    const fake = (file, body) => {
      writeFileSync(file, `#!/usr/bin/env bash\n${body}`);
      chmodSync(file, 0o755);
    };
    fake(path.join(binDir, 'npm'), `WHAT="npm $*"\n${record}[ -n "${npmFail}" ] && [ "$*" = "${npmFail}" ] && exit 1\nexit 0\n`);
    fake(path.join(binDir, 'npx'), `WHAT="vercel \${*:3}"\n${record}case "$3" in
  list) cat "${dir}/list-output" ${listToStderr ? '>&2' : ''}; exit ${listStatus} ;;
  build) exit ${buildStatus} ;;
  deploy) echo "${DEPLOY_URL}" ;;
esac
exit 0\n`);
    fake(path.join(binDir, 'curl'), `WHAT="curl $*"\n${record}printf 'HTTP/2 ${httpStatus}\\r\\ncontent-type: application/json\\r\\nx-vercel-id: ${vercelId}\\r\\n\\r\\n'\n`);
    fake(path.join(dir, 'site/scripts/check-app-role.sh'), `WHAT="check-app-role.sh $*"\n${record}`);
    // Step 5 runs the real `node --test site/test/`: give it one test that records itself.
    mkdirSync(path.join(dir, 'site/test'));
    writeFileSync(path.join(dir, 'site/test/guard.test.cjs'),
      `const seen = Object.keys(process.env).filter((k) => /^(EMIBONNIE_DB|EMIBONNIE_DB_PREVIEW|DATABASE_URL)$/.test(k)).sort().join(' ');\n` +
      `require('node:fs').appendFileSync(${JSON.stringify(path.join(dir, 'calls'))}, \`node --test site/test/ | \${seen ? seen + ' ' : ''}\\n\`);\n`);
    const r = spawnSync('bash', [path.join(dir, 'site/scripts/deploy.sh'), ...args], {
      cwd: dir,
      env: { PATH: `${binDir}:${process.env.PATH ?? ''}`, ...env },
      encoding: 'utf8',
      input,
    });
    const calls = existsSync(path.join(dir, 'calls')) ? readFileSync(path.join(dir, 'calls'), 'utf8') : '';
    return {
      status: r.status ?? 1,
      stdout: r.stdout,
      stderr: r.stderr,
      output: `${r.stdout}${r.stderr}`,
      calls: calls.split('\n').filter(Boolean),
      staleOutputKept: existsSync(path.join(dir, '.vercel/output/stale-marker')),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** @param {string[]} calls */
const ran = (calls) => calls.map((line) => line.split(' | ')[0]);

/**
 * The `step` lines of a run, with "running"/"would run" folded together.
 * @param {string} output
 */
const steps = (output) => output.split('\n')
  .map((line) => /step (\S+): (?:running|would run|skipped \(--quick\)): (.*)$/.exec(line))
  .filter((m) => m !== null)
  .map((m) => `${m[1]}: ${m[2]}`);

for (const [label, args, env, input] of /** @type {[string, string[], Record<string, string>, string][]} */ ([
  ['preview', [], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL }, ''],
  ['production', ['--prod'], { EMIBONNIE_DB: PROD_URL }, 'yes\n'],
  ['preview --quick', ['--quick'], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL }, ''],
])) {
  test(`dry run and real run list the same steps in the same order (${label})`, () => {
    const real = runReal({ args, env, input });
    assert.equal(real.status, 0, real.output);
    const dry = runReal({ args: [...args, '--dry-run'], env });
    assert.equal(dry.status, 0, dry.output);
    assert.deepEqual(dry.calls, [], 'a dry run runs nothing');
    assert.ok(steps(real.output).length >= 10, real.output);
    assert.deepEqual(steps(dry.output), steps(real.output));
  });
}

test('a real preview run builds before it touches the database, and ships what it built', () => {
  const r = runReal();
  assert.equal(r.status, 0, r.output);
  assert.deepEqual(ran(r.calls), [
    'vercel list',
    'npm ci', 'npm run build', 'npm run check', 'npm test', 'node --test site/test/', 'npm run e2e:site',
    'vercel pull --yes --environment=preview',
    'vercel build',
    'npm run doctor', 'npm run migrate', 'check-app-role.sh ',
    'vercel deploy --prebuilt',
    `curl -sI --max-time 30 ${DEPLOY_URL}/api/home`,
  ]);
  assert.match(r.stdout, new RegExp(`^${DEPLOY_URL}$`, 'm'));
});

test('a failed vercel build stops before the migration', () => {
  for (const [args, env, input] of /** @type {[string[], Record<string, string>, string][]} */ ([
    [[], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL }, ''],
    [['--prod'], { EMIBONNIE_DB: PROD_URL }, 'yes\n'],
  ])) {
    const r = runReal({ args, env, input, buildStatus: 1 });
    assert.notEqual(r.status, 0, r.output);
    assert.ok(ran(r.calls).some((c) => c.startsWith('vercel build')), r.output);
    for (const never of ['npm run doctor', 'npm run migrate', 'check-app-role.sh', 'vercel deploy']) {
      assert.ok(!ran(r.calls).some((c) => c.startsWith(never)), `${never} must not run after a failed build:\n${r.calls.join('\n')}`);
    }
    assert.doesNotMatch(r.output, /ask for confirmation/, 'nothing to confirm once the build failed');
  }
});

test('--prod asks once the build is ready: a typo asks again, and "no" stops before the database is touched', () => {
  const r = runReal({ args: ['--prod'], env: { EMIBONNIE_DB: PROD_URL }, input: 'yse\nno\n' });
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /please type 'yes' or 'no'/);
  assert.match(r.output, /not confirmed -- stopping before the database is touched/);
  assert.deepEqual(ran(r.calls).slice(-2), ['vercel pull --yes --environment=production', 'vercel build --prod']);
  assert.doesNotMatch(r.output, /prod-secret-token/);
});

test('answering no leaves .vercel/output in place', () => {
  const r = runReal({ args: ['--prod'], env: { EMIBONNIE_DB: PROD_URL }, input: 'no\n' });
  assert.equal(r.status, 1, r.output);
  assert.equal(r.staleOutputKept, true);
});

test('the database URL reaches only doctor, migrate and the role check; the EMIBONNIE_DB* vars reach nothing', () => {
  const r = runReal({
    env: { EMIBONNIE_DB_PREVIEW: PREVIEW_URL, EMIBONNIE_DB: PROD_URL, DATABASE_URL: 'postgres://decoy-should-be-unset@host/db', DB_URL: 'postgres://exported-db-url-decoy@host/db' },
  });
  assert.equal(r.status, 0, r.output);
  for (const line of r.calls) {
    const [what, seen] = line.split(' | ');
    if (/^(npm run doctor|npm run migrate|check-app-role\.sh)/.test(what)) {
      assert.equal(seen, `DATABASE_URL  db=${PREVIEW_URL}`, line);
    } else {
      assert.equal(seen, '', line);
    }
  }
  assert.doesNotMatch(r.calls.join('\n'), /decoy/);
  assert.doesNotMatch(r.output, /preview-secret-token|prod-secret-token|decoy/);
});

for (const [label, fake, why] of /** @type {[string, Parameters<typeof runReal>[0], RegExp][]} */ ([
  ['empty output', { listOutput: '' }, /showed no deployment URL/],
  ['"No deployments found."', { listOutput: 'Vercel CLI 65.1.0\n> No deployments found.\n', listToStderr: true }, /showed no deployment URL/],
  ['unfamiliar wording, exit 0', { listOutput: 'Something changed in this CLI version\n' }, /showed no deployment URL/],
  ['an error', { listOutput: 'Error: Not authorized\n', listToStderr: true, listStatus: 1 }, /'vercel list' failed \(exit 1\)/],
])) {
  test(`first-deploy check stops on ${label}, before step 1 (fix round 4, N3)`, () => {
    const r = runReal(fake);
    assert.notEqual(r.status, 0, r.output);
    assert.deepEqual(ran(r.calls), ['vercel list'], 'nothing after the check may run');
    assert.match(r.output, why);
    assert.match(r.output, /task deploy:prod/);
    assert.doesNotMatch(r.output, /preview-secret-token/);
  });
}

for (const toStderr of [false, true]) {
  test(`first-deploy check proceeds when 'vercel list' shows a deployment URL (on ${toStderr ? 'stderr' : 'stdout'})`, () => {
    const r = runReal({ listToStderr: toStderr, npmFail: 'ci' });
    assert.match(r.output, /confirmed: this project already has at least one deployment/);
    assert.deepEqual(ran(r.calls), ['vercel list', 'npm ci'], 'it should reach step 1 (the fake npm then stops it)');
  });
}

test('deploy reports where the function ran', () => {
  const elsewhere = runReal({ vercelId: 'sin1::iad1::a' });
  assert.equal(elsewhere.status, 0, elsewhere.output);
  assert.match(elsewhere.stderr, /function ran in iad1, expected sin1/);

  const home = runReal({ vercelId: 'sin1::sin1::a' });
  assert.equal(home.status, 0, home.output);
  assert.match(home.stdout, /function region sin1/);
  assert.doesNotMatch(home.stderr, /function ran in/);
});

test('deploy says when it could not check the function region', () => {
  const r = runReal({ httpStatus: '401' });
  assert.equal(r.status, 0, r.output);
  assert.match(r.stderr, /could not check the function region \(HTTP 401\)/);
});
