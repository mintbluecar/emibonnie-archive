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
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

/**
 * A `git commit` invocation inside a shell command string: `git`, then
 * any number of flag tokens that take a value (`-c key=value`, `-C dir`)
 * or a bare `--flag`/`--flag=value`, then `commit` as its own word. The
 * leading alternation anchors each match to the start of a command (so
 * `echo "git commit"` -- "commit" inside an unrelated argument -- never
 * matches) while still allowing a preceding `cd a &&`, `;`, `|`, or `(`.
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

const REASON = "Refusing: this would edit or commit on main. Check out or create a branch first.";

/**
 * @param {{ tool_name?: string, tool_input?: { command?: string }, cwd?: string }} input
 * @param {(cwd: string) => string|null} branchOf
 * @returns {{ block: boolean, reason?: string }}
 */
export function decide(input, branchOf) {
  const { tool_name: toolName, tool_input: toolInput, cwd } = input;
  const isGuardedBash = toolName === 'Bash' && isGitCommit(toolInput?.command ?? '');
  if (!EDIT_TOOLS.has(toolName ?? '') && !isGuardedBash) return { block: false };
  if (branchOf(cwd ?? process.cwd()) !== 'main') return { block: false };
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
