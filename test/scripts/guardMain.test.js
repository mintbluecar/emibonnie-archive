// @ts-check
/**
 * Claude Code `PreToolUse` hook (`.claude/settings.json` wires it up for
 * `Edit|Write|NotebookEdit|Bash`): refuses an edit tool or a `git commit`
 * while the repo is on `main`, so no agent edits or commits there.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decide, isGitCommit } from '../../scripts/hooks/guardMain.js';

const SCRIPT_PATH = fileURLToPath(new URL('../../scripts/hooks/guardMain.js', import.meta.url));

/** @type {(cwd: string) => string|null} */
const onMain = () => 'main';
/** @type {(cwd: string) => string|null} */
const onFeature = () => 'feature';
/** @type {(cwd: string) => string|null} */
const notARepo = () => null;

for (const toolName of ['Edit', 'Write', 'NotebookEdit']) {
  test(`decide blocks ${toolName} on main`, () => {
    const { block } = decide({ tool_name: toolName, cwd: '/repo' }, onMain);
    assert.equal(block, true);
  });

  test(`decide allows ${toolName} on a feature branch`, () => {
    const { block } = decide({ tool_name: toolName, cwd: '/repo' }, onFeature);
    assert.equal(block, false);
  });

  test(`decide allows ${toolName} when cwd isn't a repo (branchOf returns null)`, () => {
    const { block } = decide({ tool_name: toolName, cwd: '/repo' }, notARepo);
    assert.equal(block, false);
  });
}

for (const command of ['git commit -m x', 'git -C ../repo commit', 'cd a && git commit --amend']) {
  test(`decide blocks Bash "${command}" on main`, () => {
    const { block } = decide({ tool_name: 'Bash', tool_input: { command }, cwd: '/repo' }, onMain);
    assert.equal(block, true);
  });
}

for (const command of ['git status', 'git log --grep=commit', 'echo "git commit"', 'npm test']) {
  test(`decide allows Bash "${command}" on main`, () => {
    const { block } = decide({ tool_name: 'Bash', tool_input: { command }, cwd: '/repo' }, onMain);
    assert.equal(block, false);
  });
}

test('decide allows Read on main', () => {
  const { block } = decide({ tool_name: 'Read', cwd: '/repo' }, onMain);
  assert.equal(block, false);
});

test('a blocked reason tells the agent to create a branch', () => {
  const { block, reason } = decide({ tool_name: 'Edit', cwd: '/repo' }, onMain);
  assert.equal(block, true);
  assert.ok(reason?.includes('create a branch'), `reason should mention creating a branch, got: ${reason}`);
});

test('isGitCommit matches a git commit invocation past a cd/&&, a -C, or a leading -c flag', () => {
  assert.equal(isGitCommit('git commit -m x'), true);
  assert.equal(isGitCommit('git -C ../repo commit'), true);
  assert.equal(isGitCommit('cd a && git commit --amend'), true);
  assert.equal(isGitCommit('git -c user.name=x commit'), true);
});

test("isGitCommit doesn't match commit appearing elsewhere in the command", () => {
  assert.equal(isGitCommit('git status'), false);
  assert.equal(isGitCommit('git log --grep=commit'), false);
  assert.equal(isGitCommit('echo "git commit"'), false);
  assert.equal(isGitCommit('npm test'), false);
});

test('running the script with malformed stdin exits 0 (allows the call)', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
});

test('running the script with valid JSON that is not an object (e.g. "null") still exits 0', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], { input: 'null', encoding: 'utf8' });
  assert.equal(result.status, 0);
});
