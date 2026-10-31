// @ts-check
/**
 * Styling system Task 5, fix rounds 1 and 2, finding 1 (spec "6.
 * Enforcement"): `scripts/stylelint/no-rebuilt-primitive.js`, a local
 * stylelint plugin flagging a component rule that redeclares a
 * primitive's look -- background + border-radius + padding, together,
 * on a button- *or field*-like selector -- instead of using
 * `btn`/`field`. Round 2 added the field half: `input` (any type but
 * `checkbox`/`radio`, which keep the `check` primitive's look instead)
 * and classes ending `__field`/`__input`/`__control`/`__search`/
 * `__textarea`/`__select`. Exercised two ways: the plugin alone (its own
 * rule logic), and through the real `.stylelintrc.json` (proving it's
 * wired to `src/styles/components/*.css` only, by file path, not by
 * content).
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

test('fix round 2: flags a field-like selector that declares background + border-radius + padding together', async () => {
  for (const [label, code] of [
    ['a bare input', 'input { background: red; border-radius: 4px; padding: 4px; }'],
    ['input[type=text]', 'input[type="text"] { background: red; border-radius: 4px; padding: 4px; }'],
    ["base.css's own field selector form", 'input:not([type="checkbox"]):not([type="radio"]) { background: red; border-radius: 4px; padding: 4px; }'],
    ['a textarea element', 'textarea { background: red; border-radius: 4px; padding: 4px; }'],
    ['a __field class', '.c-foo__field { background: red; border-radius: 4px; padding: 4px; }'],
    ['a __input class', '.c-foo__input { background: red; border-radius: 4px; padding: 4px; }'],
    ['a __control class', '.c-foo__control { background: red; border-radius: 4px; padding: 4px; }'],
    ['a __search class', '.c-foo__search { background: red; border-radius: 4px; padding: 4px; }'],
    ['a __textarea class', '.c-foo__textarea { background: red; border-radius: 4px; padding: 4px; }'],
    ['a __select class', '.c-foo__select { background: red; border-radius: 4px; padding: 4px; }'],
  ]) {
    const result = await lintWithPlugin(code);
    assert.equal(result.errored, true, label);
    assert.match(result.report, /local\/no-rebuilt-primitive/, label);
  }
});

test('fix round 2: checkbox and radio inputs stay excluded, even with all three declared', async () => {
  for (const [label, code] of [
    ['input[type=checkbox]', 'input[type="checkbox"] { background: red; border-radius: 4px; padding: 4px; }'],
    ['input[type=radio]', 'input[type="radio"] { background: red; border-radius: 4px; padding: 4px; }'],
  ]) {
    const result = await lintWithPlugin(code);
    assert.equal(result.errored, false, label);
  }
});

test('passes when any one of the three is missing', async () => {
  for (const [label, code] of [
    ['no border-radius', '.c-foo__save { background: red; padding: 4px; }'],
    ['no background', '.c-foo__save { border-radius: 4px; padding: 4px; }'],
    ['no padding', '.c-foo__save { background: red; border-radius: 4px; }'],
    ['field-like, no border-radius', '.c-foo__field { background: red; padding: 4px; }'],
    ['field-like, no background', 'input { border-radius: 4px; padding: 4px; }'],
    ['field-like, no padding', '.c-foo__search { background: red; border-radius: 4px; }'],
  ]) {
    const result = await lintWithPlugin(code);
    assert.equal(result.errored, false, label);
  }
});

test('passes when the selector is not button- or field-like, even with all three declared', async () => {
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
