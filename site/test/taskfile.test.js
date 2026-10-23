// @ts-check
/**
 * Offline tests for the root `Taskfile.yml` (go-task v3): that `task
 * --list` shows the expected tasks, and that `task deploy:dry` runs
 * cleanly end to end through Task itself (not just by invoking
 * scripts/deploy.sh directly, as deployScript.test.js does). Skips
 * cleanly if `task` isn't installed -- CI may not have it. Run with
 * `node --test site/test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
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
    'check-role:preview', 'check-role:prod',
    'deploy:preview', 'deploy:prod',
    'deploy:dry', 'deploy:dry-prod',
    'backup', 'test', 'check', 'e2e:site', 'dev', 'takedown',
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
  assert.match(output, /step 11: would print the deployment URL/);
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
