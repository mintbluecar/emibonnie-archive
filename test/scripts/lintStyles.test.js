// @ts-check
/**
 * `scripts/lintStyles.js` reads `.stylelintrc.json` and lints the given
 * files, returning `{ errored, report }` for `npm run check` to print and
 * fail on. Builds a throwaway fixture repo under the OS temp dir (never
 * writes into this checkout, which `npm test`'s posttest hashes).
 *
 * Until Task 15, this file also proved the `ignoreFiles` merge with
 * `scripts/stylelintPending.json`; that mechanism is retired now that
 * every component is migrated, so there is nothing pending left to prove.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lintStyles } from '../../scripts/lintStyles.js';

const MINIMAL_CONFIG = { rules: { 'color-no-hex': true } };

/** @param {(repoRoot: string) => Promise<void>} run */
async function withFixture(run) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fan-archive-lintstyles-'));
  try {
    mkdirSync(path.join(repoRoot, 'src/styles/components'), { recursive: true });
    writeFileSync(path.join(repoRoot, '.stylelintrc.json'), JSON.stringify(MINIMAL_CONFIG));
    writeFileSync(path.join(repoRoot, 'src/styles/components/good.css'), '.c-good { background: var(--x); }\n');
    writeFileSync(path.join(repoRoot, 'src/styles/components/bad.css'), '.c-bad { color: #fff; }\n');
    await run(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

test('a real violation fails, naming the file and the rule', async () => {
  await withFixture(async (repoRoot) => {
    const { errored, report } = await lintStyles({ repoRoot, files: ['src/styles/components/*.css'] });
    assert.equal(errored, true);
    assert.match(report, /bad\.css/);
    assert.match(report, /color-no-hex/);
  });
});

test('a clean file passes', async () => {
  await withFixture(async (repoRoot) => {
    const { errored, report } = await lintStyles({ repoRoot, files: ['src/styles/components/good.css'] });
    assert.equal(errored, false);
    assert.doesNotMatch(report, /good\.css/);
  });
});
