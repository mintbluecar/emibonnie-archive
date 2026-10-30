// @ts-check
/**
 * `npm run check`'s stylelint step (Styling system Task 5, spec "6.
 * Enforcement"). Lints every engine CSS file plus the bundled example
 * site's theme, the two globs `.stylelintrc.json`'s rules are written
 * for: `src/styles/**\/*.css` and `examples/*\/theme.css`.
 *
 * `.stylelintrc.json` stays plain JSON (no logic to run), so the one
 * dynamic piece -- which component files are still pending migration,
 * `scripts/stylelintPending.json` -- is merged in here as the config's
 * `ignoreFiles`, rather than duplicated into the config file by hand.
 * `test/styles/stylelintPending.test.js` keeps that list honest (every
 * entry must still exist); Task 15 is expected to shrink it to empty.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['src/styles/**/*.css', 'examples/*/theme.css'];

/**
 * Every parameter defaults to this checkout's own files, so `npm run
 * check` (no arguments) is unaffected; `test/scripts/lintStyles.test.js`
 * points `repoRoot`/`configPath`/`pendingPath` at a temp fixture instead,
 * to prove the `ignoreFiles` merge itself without touching this tree.
 * @param {{ repoRoot?: string, configPath?: string, pendingPath?: string, files?: string[] }} [options]
 * @returns {Promise<{ errored: boolean, report: string }>}
 */
export async function lintStyles(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const configPath = options.configPath ?? path.join(repoRoot, '.stylelintrc.json');
  const pendingPath = options.pendingPath ?? path.join(repoRoot, 'scripts/stylelintPending.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const ignoreFiles = JSON.parse(readFileSync(pendingPath, 'utf8'));
  const result = await stylelint.lint({
    cwd: repoRoot,
    files: options.files ?? FILES,
    config: { ...config, ignoreFiles },
    formatter: 'string',
  });
  return { errored: result.errored, report: result.report };
}

async function main() {
  const { errored, report } = await lintStyles();
  if (report) console.log(report);
  if (errored) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
