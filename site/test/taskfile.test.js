// @ts-check
/**
 * Offline tests for the root `Taskfile.yml` (go-task v3): that `task
 * --list` shows the expected tasks, and that `task deploy:dry` runs
 * cleanly end to end through Task itself (not just by invoking
 * site/scripts/deploy.sh directly, as deployScript.test.js does). Skips
 * cleanly if `task` isn't installed -- CI may not have it. Run with
 * `node --test site/test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** @returns {boolean} */
function taskInstalled() {
  try {
    execFileSync('task', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HAVE_TASK = taskInstalled();

test('task --list shows every expected task', { skip: !HAVE_TASK && 'task is not installed' }, () => {
  const output = execFileSync('task', ['--list'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const expected = [
    'setup:preview', 'setup:prod',
    'role:preview', 'role:prod',
    'role:rotate:preview', 'role:rotate:prod',
    'check-role:preview', 'check-role:prod',
    'deploy:preview', 'deploy:prod',
    'deploy:dry', 'deploy:dry-prod',
    'backup', 'test', 'check', 'e2e:site', 'dev', 'takedown', 'purge',
  ];
  for (const name of expected) {
    assert.ok(output.includes(name), `expected '${name}' in:\n${output}`);
  }
});

test('task deploy:dry runs cleanly through Task itself, with the preview env var set', { skip: !HAVE_TASK && 'task is not installed' }, () => {
  const output = execFileSync('task', ['deploy:dry'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', EMIBONNIE_DB_PREVIEW: 'postgres://preview-user:preview-secret-token@ep-preview.example.neon.tech/db' },
  });
  assert.match(output, /step 15: would run: curl -sI <deployment URL>\/api\/home/);
  assert.doesNotMatch(output, /preview-secret-token/);
});

test('task deploy:dry refuses, via its precondition, when the preview env var is empty', { skip: !HAVE_TASK && 'task is not installed' }, () => {
  assert.throws(() => {
    execFileSync('task', ['deploy:dry'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }, (/** @type {any} */ err) => {
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    assert.match(output, /EMIBONNIE_DB_PREVIEW is not set/);
    return true;
  });
});

const OWNER_URL = 'postgres://owner:owner-secret-token@ep-main.example.neon.tech/db?sslmode=require';

/**
 * Fix round 3, I-T: the `takedown` task must never splice its id argument
 * into shell text via `{{ }}` -- only through `env: TAKEDOWN_ID`, read
 * back as `"$TAKEDOWN_ID"`. Run against a scratch copy of just the two
 * Taskfiles (no network, no real database), with a fake `psql` on PATH
 * so a real `cmds:` run (for a valid id) is observable without touching
 * any database.
 */
function makeTakedownScratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fan-archive-takedown-'));
  mkdirSync(path.join(dir, 'site'));
  copyFileSync(path.join(REPO_ROOT, 'Taskfile.yml'), path.join(dir, 'Taskfile.yml'));
  copyFileSync(path.join(REPO_ROOT, 'site/Taskfile.yml'), path.join(dir, 'site/Taskfile.yml'));
  // The tasks split the owner URL with site/scripts/password.mjs (splitDbUrl).
  mkdirSync(path.join(dir, 'site/scripts'));
  copyFileSync(path.join(REPO_ROOT, 'site/scripts/password.mjs'), path.join(dir, 'site/scripts/password.mjs'));
  const binDir = path.join(dir, 'bin');
  mkdirSync(binDir);
  for (const tool of ['psql', 'pg_dump']) {
    writeFileSync(path.join(binDir, tool), `#!/usr/bin/env bash\necho "FAKE_ARGS: ${tool} $*"\necho "FAKE_PGPASSWORD: \${PGPASSWORD:-}"\necho "UPDATE 1"\n`);
    chmodSync(path.join(binDir, tool), 0o755);
  }
  return { dir, binDir };
}

/**
 * @param {string} dir @param {string} binDir @param {string} id
 * @param {string[]} [taskArgs] defaults to `takedown -y -- <id>`
 * @returns {{ status: number, output: string, touchedPayload: boolean }}
 */
function runTakedown(dir, binDir, id, taskArgs = ['takedown', '-y', '--', id]) {
  const payloadMarker = path.join(dir, 'PAYLOAD_TOUCHED');
  try {
    const output = execFileSync('task', taskArgs, {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: `${binDir}:${process.env.PATH ?? ''}`, HOME: dir, EMIBONNIE_DB: OWNER_URL },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output, touchedPayload: existsSync(payloadMarker) };
  } catch (/** @type {any} */ err) {
    return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}`, touchedPayload: existsSync(payloadMarker) };
  }
}

test('task takedown: a valid numeric id reaches the fake psql, quoted, with no shell metacharacters', { skip: !HAVE_TASK && 'task is not installed' }, () => {
  const { dir } = makeTakedownScratch();
  try {
    const { status, output } = runTakedown(dir, path.join(dir, 'bin'), '2112858824172531819');
    assert.equal(status, 0, output);
    assert.match(output, /FAKE_ARGS: psql.*-v id=2112858824172531819/);
    assert.match(output, /UPDATE 1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('task takedown: rejects `1"; touch PAYLOAD_TOUCHED; echo "` without running it', { skip: !HAVE_TASK && 'task is not installed' }, () => {
  const { dir } = makeTakedownScratch();
  try {
    const { status, output, touchedPayload } = runTakedown(dir, path.join(dir, 'bin'), '1"; touch PAYLOAD_TOUCHED; echo "');
    assert.notEqual(status, 0);
    assert.match(output, /numeric tweet id only/);
    assert.doesNotMatch(output, /FAKE_ARGS/, 'psql must never be reached');
    assert.equal(touchedPayload, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('task takedown: rejects `$(touch PAYLOAD_TOUCHED)` without running it', { skip: !HAVE_TASK && 'task is not installed' }, () => {
  const { dir } = makeTakedownScratch();
  try {
    const { status, output, touchedPayload } = runTakedown(dir, path.join(dir, 'bin'), '$(touch PAYLOAD_TOUCHED)');
    assert.notEqual(status, 0);
    assert.match(output, /numeric tweet id only/);
    assert.doesNotMatch(output, /FAKE_ARGS/, 'psql must never be reached');
    assert.equal(touchedPayload, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Fix round 4, N2: the old `grep -Eqx` check matched line by line, so a
 * value whose first line is digits passed. Through `--` Task shell-quotes
 * CLI_ARGS, but `task takedown ID=<value>` carries the newline through
 * as-is -- both routes are checked here.
 */
for (const [label, argsFor] of /** @type {[string, (id: string) => string[]][]} */ ([
  ['task takedown -- <id>', (id) => ['takedown', '-y', '--', id]],
  ['task takedown ID=<id>', (id) => ['takedown', '-y', `ID=${id}`]],
])) {
  test(`task takedown: rejects a multi-line id ('123\\n$(touch PAYLOAD_TOUCHED)') via ${label}`, { skip: !HAVE_TASK && 'task is not installed' }, () => {
    const { dir } = makeTakedownScratch();
    try {
      const payload = '123\n$(touch PAYLOAD_TOUCHED)';
      const { status, output, touchedPayload } = runTakedown(dir, path.join(dir, 'bin'), payload, argsFor(payload));
      assert.notEqual(status, 0, output);
      assert.match(output, /numeric tweet id only/);
      assert.doesNotMatch(output, /FAKE_ARGS/, 'psql must never be reached');
      assert.equal(touchedPayload, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const [label, taskArgs, tool] of /** @type {[string, string[], string][]} */ ([
  ['takedown', ['takedown', '-y', '--', '2112858824172531819'], 'psql'],
  ['backup', ['backup'], 'pg_dump'],
])) {
  test(`task ${label}: the owner password reaches ${tool} through PGPASSWORD, never argv`, { skip: !HAVE_TASK && 'task is not installed' }, () => {
    const { dir, binDir } = makeTakedownScratch();
    try {
      const { status, output } = runTakedown(dir, binDir, '', taskArgs);
      assert.equal(status, 0, output);
      const args = output.split('\n').find((line) => line.startsWith(`FAKE_ARGS: ${tool} `)) ?? '';
      assert.match(args, /postgres:\/\/owner@ep-main\.example\.neon\.tech\/db\?sslmode=require/);
      assert.doesNotMatch(args, /owner-secret-token/);
      assert.match(output, /FAKE_PGPASSWORD: owner-secret-token$/m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
