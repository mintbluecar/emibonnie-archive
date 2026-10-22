// @ts-check
/**
 * The "no plain template literal containing '<' in public/js/components/**
 * or public/js/kinds/**" rule (task-2-brief.md, "Rulings binding this
 * task" #1), tested the same way test/lint.test.js tests the layer
 * rules: `eslint.lintText` against a virtual `filePath`, so the fixture
 * never has to actually live under public/js/components/ -- it's
 * excluded from the real `npm run check` lint run simply by living here,
 * under test/fixtures/, yet is linted as if it were a components file.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { ESLint } from 'eslint';

const eslint = new ESLint();
const RULE = 'no-restricted-syntax';

/** @param {string} filePath @param {string} code @returns {Promise<string[]>} */
async function rulesHit(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => m.ruleId).filter((id) => id === RULE);
}

test('a plain template literal containing "<" fails lint under public/js/components/', async () => {
  const code = readFileSync('test/fixtures/lint/rawHtmlTemplate.js', 'utf8');
  assert.deepEqual(await rulesHit('public/js/components/fixtureBad.js', code), [RULE]);
});

test('a plain template literal containing "<" also fails lint under public/js/kinds/', async () => {
  const code = readFileSync('test/fixtures/lint/rawHtmlTemplate.js', 'utf8');
  assert.deepEqual(await rulesHit('public/js/kinds/translation/fixtureBad.js', code), [RULE]);
});

test('the same markup written with html`…` passes', async () => {
  // No import statement here (unlike a real component): resolving one against this
  // virtual path would hit an eslint-plugin-import/no-cycle crash against the real,
  // on-disk public/js/components/ directory -- see test/lint.test.js's "zzfake"
  // comment for the same issue with a real existing directory and a fake file in it.
  const code = '// @ts-check\nexport function render(x, html) {\n  return html`<p>${x}</p>`;\n}\n';
  assert.deepEqual(await rulesHit('public/js/components/fixtureGood.js', code), []);
});

test('a plain template literal with "<" is fine outside public/js/components/ and public/js/kinds/', async () => {
  const code = readFileSync('test/fixtures/lint/rawHtmlTemplate.js', 'utf8');
  assert.deepEqual(await rulesHit('public/js/pages/fixtureBad.js', code), []);
  assert.deepEqual(await rulesHit('public/js/core/fixtureBad.js', code), []);
});

test('a plain template literal with no "<" is fine even under public/js/components/', async () => {
  assert.deepEqual(await rulesHit('public/js/components/fixtureFine.js', 'const msg = `hello ${1 + 1}`;\n'), []);
});
