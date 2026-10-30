// @ts-check
/**
 * Styling system Task 5 fix round 1, finding 4: `scripts/lintStyles.js`'s
 * one piece of logic -- merging `scripts/stylelintPending.json` into the
 * stylelint config's `ignoreFiles` -- had no test of its own. Builds a
 * throwaway fixture repo under the OS temp dir (never writes into this
 * checkout, which `npm test`'s posttest hashes) with a minimal config and
 * two component files, one clean and one that violates it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { lintStyles } from '../../scripts/lintStyles.js';

const MINIMAL_CONFIG = { rules: { 'color-no-hex': true } };

/**
 * @param {{ pending: string[] }} options
 * @param {(fn: (repoRoot: string) => Promise<void>) => Promise<void>} run
 */
async function withFixture({ pending }, run) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'fan-archive-lintstyles-'));
  try {
    mkdirSync(path.join(repoRoot, 'src/styles/components'), { recursive: true });
    mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
    writeFileSync(path.join(repoRoot, '.stylelintrc.json'), JSON.stringify(MINIMAL_CONFIG));
    writeFileSync(path.join(repoRoot, 'scripts/stylelintPending.json'), JSON.stringify(pending));
    writeFileSync(path.join(repoRoot, 'src/styles/components/good.css'), '.c-good { background: var(--x); }\n');
    writeFileSync(path.join(repoRoot, 'src/styles/components/bad.css'), '.c-bad { color: #fff; }\n');
    await run(repoRoot);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

test('a file named in the pending list is ignored, even though it violates the config', async () => {
  await withFixture({ pending: ['src/styles/components/bad.css'] }, async (repoRoot) => {
    const { errored, report } = await lintStyles({ repoRoot, files: ['src/styles/components/*.css'] });
    assert.equal(errored, false);
    assert.doesNotMatch(report, /bad\.css/);
  });
});

test('a component file not on the pending list still fails on a real violation', async () => {
  await withFixture({ pending: [] }, async (repoRoot) => {
    const { errored, report } = await lintStyles({ repoRoot, files: ['src/styles/components/*.css'] });
    assert.equal(errored, true);
    assert.match(report, /bad\.css/);
    assert.match(report, /color-no-hex/);
  });
});

test('a non-pending file with no violation still passes (the merge does not ignore everything)', async () => {
  await withFixture({ pending: ['src/styles/components/bad.css'] }, async (repoRoot) => {
    const { report } = await lintStyles({ repoRoot, files: ['src/styles/components/*.css'] });
    assert.doesNotMatch(report, /good\.css/);
  });
});
