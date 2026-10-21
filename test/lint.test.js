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
