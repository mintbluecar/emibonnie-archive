// @ts-check
/**
 * Claude Code `PreToolUse` hook (docs:
 * https://docs.claude.com/en/docs/claude-code/hooks -- "PreToolUse", exit
 * code behaviour: exit code `2` blocks the tool call and feeds stderr
 * back to Claude as the reason; exit code `0` allows it): refuses an
 * edit (`Edit`, `Write`, `NotebookEdit`) or a `git commit` (`Bash`)
 * while the repo's current branch is `main`, so no agent edits files or
 * commits there by mistake. Wired up for those tools in
 * `.claude/settings.json`.
 *
 * The hook receives the tool call as JSON on stdin (`tool_name`,
 * `tool_input`, `cwd`); malformed input is never blocked.
 *
 * The branch judged is the *edited* file's, not the session's `cwd`: for
 * `Edit`/`Write`/`NotebookEdit`, that's `tool_input.file_path` (or
 * `notebook_path`) -- a session can sit in one checkout while editing a
 * file that resolves into another (a worktree, or a path outside any
 * repo entirely). `cwd` is used only for `Bash`, and as the fallback
 * when a tool gives no path at all.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

/**
 * A `git commit` invocation inside a shell command string: `git`, then
 * any number of flag tokens that take a value (`-c key=value`, `-C dir`)
 * or a bare `--flag`/`--flag=value`, then `commit` as its own word. The
 * leading alternation requires `git` to begin the command (`^`), to
 * follow a shell connector (`;`, `&`, `|`, `(`, optionally with trailing
 * spaces), or simply to follow a space -- so it matches `git commit`
 * wherever it stands as its own word (after `cd a &&`, a `;`, a `|`, or
 * just a space), not only right after one of those connectors.
 * `echo "git commit"` still doesn't match: the quote sits between the
 * space and `git`, so no alternative lines up with it.
 */
const GIT_COMMIT = /(?:^|[;&|(]\s*|\s)git(?:\s+-[cC]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+commit\b/;

/**
 * @param {string} command
 * @returns {boolean}
 */
export function isGitCommit(command) {
  return GIT_COMMIT.test(command);
}

/**
 * The repo's current branch at `cwd`. Null when `cwd` isn't inside a git
 * repository, or on a detached `HEAD` (both print an empty line).
 * @param {string} cwd
 * @returns {string|null}
 */
function gitBranchOf(cwd) {
  try {
    const out = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

const REASON = "Refusing: this would edit or commit on main. Check out or create a branch first. "
  + 'On main with a merge in progress, merge main into your feature branch instead.';

/**
 * The nearest directory that exists, walking up from `targetPath`'s
 * parent. `targetPath` itself may not exist yet (e.g. `Write` creating a
 * new file), so this starts one level up and climbs until it finds a
 * directory that's really there, stopping at the filesystem root.
 * @param {string} targetPath
 * @returns {string}
 */
function nearestExistingDir(targetPath) {
  let dir = path.dirname(targetPath);
  while (!existsSync(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  return dir;
}

/**
 * Whether `input` is a call the guard cares about at all: an edit tool,
 * or a Bash `git commit`.
 * @param {{ tool_name?: string, tool_input?: { command?: string } }} input
 * @returns {boolean}
 */
function isGuardedCall(input) {
  const { tool_name: toolName, tool_input: toolInput } = input;
  if (EDIT_TOOLS.has(toolName ?? '')) return true;
  return toolName === 'Bash' && isGitCommit(toolInput?.command ?? '');
}

/**
 * The directory whose branch decides a guarded call: the edited file's
 * nearest existing parent for `Edit`/`Write`/`NotebookEdit`; `cwd` (or
 * `process.cwd()` when that's missing too) otherwise.
 * @param {{ tool_name?: string, tool_input?: { file_path?: string, notebook_path?: string }, cwd?: string }} input
 * @returns {string}
 */
function dirToJudge(input) {
  const { tool_name: toolName, tool_input: toolInput, cwd } = input;
  const targetPath = EDIT_TOOLS.has(toolName ?? '') ? (toolInput?.file_path ?? toolInput?.notebook_path) : undefined;
  return targetPath !== undefined ? nearestExistingDir(targetPath) : (cwd ?? process.cwd());
}

/**
 * @param {{ tool_name?: string, tool_input?: { command?: string, file_path?: string, notebook_path?: string }, cwd?: string }} input
 * @param {(cwd: string) => string|null} branchOf
 * @returns {{ block: boolean, reason?: string }}
 */
export function decide(input, branchOf) {
  if (!isGuardedCall(input)) return { block: false };
  if (branchOf(dirToJudge(input)) !== 'main') return { block: false };
  return { block: true, reason: REASON };
}

/** @returns {string} */
function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  /** @type {any} */
  let input;
  try {
    input = JSON.parse(readStdin());
  } catch {
    return;
  }
  if (typeof input !== 'object' || input === null) return;
  const { block, reason } = decide(input, gitBranchOf);
  if (block) {
    console.error(reason);
    process.exitCode = 2;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
