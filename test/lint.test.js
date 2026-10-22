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

/** Every rule id ESLint reports, unfiltered. @param {string} filePath @param {string} code @returns {Promise<(string|null)[]>} */
async function allRulesHit(filePath, code) {
  const [result] = await eslint.lintText(`// @ts-check\n${code}\n`, { filePath });
  return result.messages.map((m) => m.ruleId);
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

test('public/js is browser code: it may not import src/**', async () => {
  // A path under a fictitious, not-on-disk subdirectory, like the kinds/domain.js
  // cases above: a real existing directory here hits an unrelated eslint-plugin-import
  // "import/no-cycle" crash (confirmed against a plain src/domain/text.js import too).
  const file = 'public/js/core/zzfake/x.js';
  assert.deepEqual(await rulesHit(file, "export { loadSite } from '../../../../src/site/loadSite.js';"), ['no-restricted-imports']);
  assert.deepEqual(await rulesHit(file, "export { kindsRegistry } from '../../../../src/kinds/_registry.js';"), ['no-restricted-imports']);
  assert.deepEqual(await rulesHit(file, "export { html } from '../../core/html.js';"), []);
});

test("public/js importing the absolute '/site/site.js' is not an unresolved-import error", async () => {
  assert.deepEqual(await allRulesHit('public/js/core/zzfake/site.js', "export { site } from '/site/site.js';"), []);
});

test('public/js/state is pure data: no components, pages or kinds (review round 1, M5)', async () => {
  const file = 'public/js/state/zzfake/x.js';
  assert.deepEqual(await rulesHit(file, "export { render } from '../../components/chips.js';"), ['no-restricted-imports']);
  assert.deepEqual(await rulesHit(file, "export { start } from '../../pages/search.js';"), ['no-restricted-imports']);
  assert.deepEqual(await rulesHit(file, "export { KIND_UI } from '../../kinds/_registry.js';"), ['no-restricted-imports']);
  assert.deepEqual(await rulesHit(file, "export { html } from '../../core/html.js';"), []);
});
