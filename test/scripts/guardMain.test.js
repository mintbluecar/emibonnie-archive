// @ts-check
/**
 * Claude Code `PreToolUse` hook (`.claude/settings.json` wires it up for
 * `Edit|Write|NotebookEdit|Bash`): refuses an edit tool or a `git commit`
 * while the repo is on `main`, so no agent edits or commits there.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

/**
 * `decide` must judge the branch of the edited file, not the session
 * `cwd` -- a Claude Code session can sit in one checkout while editing a
 * file that resolves into another (a worktree, or a file outside any
 * repo entirely). These use real temp directories so `nearestExistingDir`
 * (which calls the real `fs.existsSync`) has real paths to walk, with an
 * injected `branchOf` standing in for git.
 */
test('decide for Edit/Write/NotebookEdit judges the branch of the file_path/notebook_path, not cwd', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fan-archive-guard-'));
  try {
    const mainRepo = path.join(root, 'main-repo');
    const worktree = path.join(root, 'feature-worktree');
    const outside = path.join(root, 'not-a-repo');
    mkdirSync(path.join(mainRepo, 'src'), { recursive: true });
    mkdirSync(path.join(worktree, 'src'), { recursive: true });
    mkdirSync(outside, { recursive: true });

    /** @type {(cwd: string) => string|null} */
    const branchOf = (cwd) => {
      if (cwd.startsWith(worktree)) return 'feature';
      if (cwd.startsWith(mainRepo)) return 'main';
      return null; // outside any repo
    };

    // File outside any repo entirely, session cwd on main -> allowed.
    assert.equal(
      decide({ tool_name: 'Write', tool_input: { file_path: path.join(outside, 'notes.txt') }, cwd: mainRepo }, branchOf).block,
      false,
    );

    // File inside a feature-branch worktree, session cwd on main -> allowed.
    // The immediate parent ('deep/nested') doesn't exist yet (e.g. Write
    // creating it), so this also exercises walking up to the nearest
    // directory that does exist ('src').
    assert.equal(
      decide(
        { tool_name: 'Edit', tool_input: { file_path: path.join(worktree, 'src', 'deep', 'nested', 'a.css') }, cwd: mainRepo },
        branchOf,
      ).block,
      false,
    );

    // File inside the main checkout, session cwd also on main -> blocked.
    assert.equal(
      decide(
        { tool_name: 'NotebookEdit', tool_input: { notebook_path: path.join(mainRepo, 'src', 'nb.ipynb') }, cwd: mainRepo },
        branchOf,
      ).block,
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('decide falls back to cwd for Bash, and to process.cwd() when cwd is missing', () => {
  /** @type {(cwd: string) => string|null} */
  const branchOf = (cwd) => (cwd === process.cwd() ? 'main' : 'feature');
  const { block } = decide({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }, branchOf);
  assert.equal(block, true);
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
