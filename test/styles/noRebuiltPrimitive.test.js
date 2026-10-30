// @ts-check
/**
 * Styling system Task 5 fix round 1, finding 1 (spec "6. Enforcement"):
 * `scripts/stylelint/no-rebuilt-primitive.js`, a local stylelint plugin
 * flagging a component rule that redeclares a primitive's look --
 * background + border-radius + padding, together, on a button-like
 * selector -- instead of using `btn`/`field`. Exercised two ways: the
 * plugin alone (its own rule logic), and through the real
 * `.stylelintrc.json` (proving it's wired to `src/styles/components/*.css`
 * only, by file path, not by content).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import stylelint from 'stylelint';
import plugin from '../../scripts/stylelint/no-rebuilt-primitive.js';

const PLUGIN_CONFIG = { plugins: [plugin], rules: { 'local/no-rebuilt-primitive': true } };
const REAL_CONFIG = JSON.parse(readFileSync('.stylelintrc.json', 'utf8'));

/** @param {string} code @param {string} [codeFilename] */
async function lintWithPlugin(code, codeFilename = 'src/styles/components/foo.css') {
  const result = await stylelint.lint({ code, codeFilename, config: PLUGIN_CONFIG, formatter: 'string' });
  return result;
}

test('flags a button-like selector that declares background + border-radius + padding together', async () => {
  for (const [label, code] of [
    ['a __save class', '.c-foo__save { background: red; border-radius: 4px; padding: 4px; }'],
    ['a bare button element', 'button { background: red; border-radius: 4px; padding: 4px; }'],
    ['input[type=submit]', 'input[type="submit"] { background: red; border-radius: 4px; padding: 4px; }'],
    ['a select', 'select { background-color: red; border-radius: 4px; padding: 4px 8px; }'],
    ['one of several comma-separated selectors matches', '.c-foo, .c-foo__next { background: red; border-radius: 4px; padding: 4px; }'],
  ]) {
    const result = await lintWithPlugin(code);
    assert.equal(result.errored, true, label);
    assert.match(result.report, /local\/no-rebuilt-primitive/, label);
  }
});

test('passes when any one of the three is missing', async () => {
  for (const [label, code] of [
    ['no border-radius', '.c-foo__save { background: red; padding: 4px; }'],
    ['no background', '.c-foo__save { border-radius: 4px; padding: 4px; }'],
    ['no padding', '.c-foo__save { background: red; border-radius: 4px; }'],
  ]) {
    const result = await lintWithPlugin(code);
    assert.equal(result.errored, false, label);
  }
});

test('passes when the selector is not button-like, even with all three declared', async () => {
  const result = await lintWithPlugin('.c-foo__bar { background: red; border-radius: 4px; padding: 4px; }');
  assert.equal(result.errored, false);
});

test('through the real .stylelintrc.json: fires in src/styles/components/, not elsewhere', async () => {
  const code = '.c-foo__save { background: red; border-radius: 4px; padding: 4px; }';

  const inComponents = await stylelint.lint({
    code,
    codeFilename: 'src/styles/components/add.css',
    config: { ...REAL_CONFIG, ignoreFiles: [] },
    formatter: 'string',
  });
  assert.match(inComponents.report, /local\/no-rebuilt-primitive/);

  const inPrimitives = await stylelint.lint({
    code,
    codeFilename: 'src/styles/primitives/button.css',
    config: { ...REAL_CONFIG, ignoreFiles: [] },
    formatter: 'string',
  });
  assert.doesNotMatch(inPrimitives.report, /local\/no-rebuilt-primitive/);
});
