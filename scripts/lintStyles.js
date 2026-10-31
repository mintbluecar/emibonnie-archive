// @ts-check
/**
 * `npm run check`'s stylelint step (spec "6. Enforcement"). Lints every
 * engine CSS file plus the bundled example site's theme, the two globs
 * `.stylelintrc.json`'s rules are written for: `src/styles/**\/*.css` and
 * `examples/*\/theme.css`.
 *
 * Until the styling-system migration finished, a dynamic `ignoreFiles`
 * list (`scripts/stylelintPending.json`, merged into the config here)
 * excused component files not yet moved onto tokens and primitives.
 * Every component is migrated now (Task 15), so that list -- and the
 * merge -- is retired: a component file that fails this lint is a real
 * violation, never a pending one.
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
 * points `repoRoot`/`configPath` at a temp fixture instead, to prove this
 * reads a config and lints files without touching this tree.
 * @param {{ repoRoot?: string, configPath?: string, files?: string[] }} [options]
 * @returns {Promise<{ errored: boolean, report: string }>}
 */
export async function lintStyles(options = {}) {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const configPath = options.configPath ?? path.join(repoRoot, '.stylelintrc.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const result = await stylelint.lint({
    cwd: repoRoot,
    files: options.files ?? FILES,
    config,
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
