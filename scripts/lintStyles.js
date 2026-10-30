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
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** @returns {Promise<{ errored: boolean, report: string }>} */
export async function lintStyles() {
  const config = JSON.parse(readFileSync(new URL('../.stylelintrc.json', import.meta.url), 'utf8'));
  const ignoreFiles = JSON.parse(readFileSync(new URL('./stylelintPending.json', import.meta.url), 'utf8'));
  const result = await stylelint.lint({
    cwd: REPO_ROOT,
    files: ['src/styles/**/*.css', 'examples/*/theme.css'],
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
