// @ts-check
/**
 * The layer rules in eslint.config.js do what they say: each case lints a
 * one-line import as if it lived at a real path in the repo.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint();

/**
 * The layer rule's reports (other rules, such as import/no-unresolved for
 * a made-up path, are not what these cases test).
 * @param {string} filePath @param {string} code @returns {Promise<string[]>}
 */
async function rulesHit(filePath, code) {
  const [result] = await eslint.lintText(`// @ts-check\n${code}\n`, { filePath });
  return result.messages.map((m) => m.ruleId ?? m.message).filter((rule) => rule === 'no-restricted-imports');
}

test('services may import from src/kinds only _registry.js and defineKind.js', async () => {
  const file = 'src/services/hubs.js';
  assert.deepEqual(await rulesHit(file, "export { kindsRegistry } from '../kinds/_registry.js';"), []);
  assert.deepEqual(await rulesHit(file, "export { defineKind } from '../kinds/defineKind.js';"), []);
  assert.deepEqual(await rulesHit(file, "export { loadDetails } from '../kinds/translation/repo.js';"), ['no-restricted-imports']);
  assert.deepEqual(await rulesHit(file, "export { refreshEdits } from '../kinds/translation/upkeep.js';"), ['no-restricted-imports']);
  assert.deepEqual(await rulesHit('src/services/nested/x.js', "export { present } from '../../kinds/translation/presenter.js';"), ['no-restricted-imports']);
});

test("a kind's domain.js may import only from src/domain/", async () => {
  const file = 'src/kinds/translation/domain.js';
  assert.deepEqual(await rulesHit(file, "export { norm } from '../../domain/text.js';"), []);
  for (const code of [
    "export { loadDetails } from './repo.js';",
    "export { present } from './presenter.js';",
    "export { defineKind } from '../defineKind.js';",
    "export { fetchTweet } from '../../sources/fetchTweet.js';",
    "export { visibleItem } from '../../repo/visibility.js';",
    "export { readFileSync } from 'node:fs';",
    "export { default as x } from 'esbuild';",
    "export { norm } from '../../domain/../repo/text.js';",
  ]) {
    assert.deepEqual(await rulesHit(file, code), ['no-restricted-imports'], code);
  }
});
