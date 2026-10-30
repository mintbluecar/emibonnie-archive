// @ts-check
/**
 * Styling system Task 5 fix round 1, findings 2 and 3: two
 * `.stylelintrc.json` rules, exercised directly against the real config
 * (not just the end-to-end `src/styles/**\/*.css` run, which only proves
 * today's files happen to pass).
 *
 * Finding 2: border widths outside tokens.css are only ever 0 or a
 * hairline (1px/1.5px/2px) -- `declaration-property-value-disallowed-list`
 * on every `border`/`border-<side>`/`border-width`/`border-<side>-width`.
 *
 * Finding 3: `selector-disallowed-list`'s primitive-name regex (components/
 * only) needs an explicit boundary -- end of string, `__`, `--`, or any
 * non-word/non-hyphen character -- so it catches `.btn__icon` and
 * `.card--compact` but never a hyphenated name that merely starts with a
 * primitive's name, like `.card-stack`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import stylelint from 'stylelint';

const REAL_CONFIG = JSON.parse(readFileSync('.stylelintrc.json', 'utf8'));

/** @param {string} code @returns {Promise<import('stylelint').LinterResult>} */
function lintComponent(code) {
  return stylelint.lint({
    code,
    codeFilename: 'src/styles/components/foo.css',
    config: { ...REAL_CONFIG, ignoreFiles: [] },
    formatter: 'string',
  });
}

test('border widths: only 0 and hairlines (1px/1.5px/2px) pass, outside tokens.css', async () => {
  const okCases = ['1px', '1.5px', '2px', '0'].flatMap((value) => (
    ['border', 'border-top', 'border-width', 'border-bottom-width'].map((prop) => [prop, value])
  ));
  const results = await Promise.all(
    okCases.map(([prop, value]) => lintComponent(`.c-foo { ${prop}: ${value} solid var(--color-card-shadow); }`)),
  );
  results.forEach((result, i) => assert.doesNotMatch(result.report, /declaration-property-value-disallowed-list/, okCases[i].join(': ')));

  const badCases = ['3px', '10px', '0.5px', '4px'].flatMap((value) => (
    ['border', 'border-left', 'border-width', 'border-right-width'].map((prop) => [prop, value])
  ));
  const badResults = await Promise.all(badCases.map(([prop, value]) => lintComponent(`.c-foo { ${prop}: ${value} solid red; }`)));
  badResults.forEach((result, i) => assert.match(result.report, /declaration-property-value-disallowed-list/, badCases[i].join(': ')));
});

test('border-radius and border-color are untouched by the border-width rule', async () => {
  const result = await lintComponent('.c-foo { border-color: red; }');
  assert.doesNotMatch(result.report, /declaration-property-value-disallowed-list/);
});

test('selector-disallowed-list flags a primitive name at a real boundary', async () => {
  const selectors = ['.btn', '.btn__icon', '.card--compact', '.c-x .chip', '.table'];
  const results = await Promise.all(selectors.map((selector) => lintComponent(`${selector} { color: red; }`)));
  results.forEach((result, i) => {
    assert.equal(result.errored, true, selectors[i]);
    assert.match(result.report, /selector-disallowed-list/, selectors[i]);
  });
});

test('selector-disallowed-list never flags a hyphenated name that merely starts with a primitive name', async () => {
  const selectors = ['.card-stack', '.table-wrapper', '.c-btnish', '.labelled'];
  const results = await Promise.all(selectors.map((selector) => lintComponent(`${selector} { color: red; }`)));
  results.forEach((result, i) => assert.equal(result.errored, false, selectors[i]));
});

test('selector-disallowed-list covers the later primitives too: segmented and tap-link (final review M2)', async () => {
  const flagged = ['.segmented', '.segmented__option', '.tap-link', '.c-x .tap-link--quiet'];
  const flaggedResults = await Promise.all(flagged.map((selector) => lintComponent(`${selector} { color: red; }`)));
  flaggedResults.forEach((result, i) => {
    assert.equal(result.errored, true, flagged[i]);
    assert.match(result.report, /selector-disallowed-list/, flagged[i]);
  });
  const allowed = ['.segmented-control', '.tap-linker', '.c-tap-link'];
  const allowedResults = await Promise.all(allowed.map((selector) => lintComponent(`${selector} { color: red; }`)));
  allowedResults.forEach((result, i) => assert.equal(result.errored, false, allowed[i]));
});
