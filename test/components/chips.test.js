// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { FakeEl } from '../helpers/fakeDom.js';
// Dynamic import: see test/components/header.test.js for why.
const { render, bind, hashtagChip, setOn } = await import('../../public/js/components/chips.js');

test('chips: renders each label, marks the active one, escapes text', () => {
  const markup = String(render({ items: [{ label: '<b>all</b>', active: true }, { label: 'luna', colour: '#9b6cff' }] }));
  assert.ok(!markup.includes('<b>all</b>'));
  assert.match(markup, /&lt;b&gt;all&lt;\/b&gt;/);
  assert.match(markup, /class="chip c-chips__chip chip--on"[^>]*>&lt;b&gt;all&lt;\/b&gt;/);
  assert.match(markup, /data-c="#9b6cff"/);
});

test('chips: a chip with `value` is a real <button> (native Enter/Space activation), with aria-pressed reflecting active and data-value', () => {
  const markup = String(render({ items: [{ label: 'sol', active: true, value: 1 }, { label: 'luna', active: false, value: 2 }] }));
  assert.match(markup, /<button type="button" class="chip c-chips__chip chip--on" aria-pressed="true" data-value="1">sol<\/button>/);
  assert.match(markup, /<button type="button" class="chip c-chips__chip" aria-pressed="false" data-value="2">luna<\/button>/);
});

test('chips: a chip with no `value` (a display-only pill) stays a <span>, with no aria-pressed', () => {
  const markup = String(render({ items: [{ label: 'show / interview' }] }));
  assert.match(markup, /<span class="chip c-chips__chip">show \/ interview<\/span>/);
  assert.ok(!markup.includes('<button'));
  assert.ok(!markup.includes('aria-pressed'));
});

test('bind: sets --c from a valid data-c, via the shared applyColours() validation', () => {
  const chip = new FakeEl({ 'data-c': '#b5651d' });
  const root = new FakeEl({}, [chip]);
  bind(root);
  assert.equal(chip.styleProps['--c'], '#b5651d');
});

test('bind: an invalid data-c is never applied', () => {
  const chip = new FakeEl({ 'data-c': 'red; background:url(x)' });
  const root = new FakeEl({}, [chip]);
  bind(root);
  assert.equal(chip.styleProps['--c'], undefined);
});

test('CSS (Task 10c g; styling system Task 12): a chip is the chip primitive -- its content plus the --chip-pad-y/--chip-pad-x tokens, never a fixed height, with a >= 24px target -- and the row wraps with a row gap', () => {
  const primitive = readFileSync('src/styles/primitives/chip.css', 'utf8');
  const rule = /\.chip\s*\{([^}]*)\}/.exec(primitive)?.[1] ?? '';
  assert.match(rule, /padding:\s*var\(--chip-pad-y\)\s+var\(--chip-pad-x\)/);
  assert.match(rule, /min-height:\s*var\(--target-min\)/);
  assert.doesNotMatch(rule, /(^|[^-])height:/);
  const css = readFileSync('src/styles/components/chips.css', 'utf8');
  assert.match(css, /\.c-chips\s*\{[^}]*gap:\s*var\(--space-2\) var\(--space-1\)/, 'wrapped rows get a row gap (d)');
});

test('setOn: switches a chip\'s look and its aria-pressed together', () => {
  /** @type {string[]} */
  const toggled = [];
  /** @type {Record<string, string>} */
  const attrs = {};
  const chip = { classList: { toggle: (/** @type {string} */ c, /** @type {boolean} */ on) => toggled.push(`${c}:${on}`) }, setAttribute: (/** @type {string} */ k, /** @type {string} */ v) => { attrs[k] = v; } };
  setOn(chip, true);
  setOn(chip, false);
  assert.deepEqual(toggled, ['chip--on:true', 'chip--on:false']);
  assert.equal(attrs['aria-pressed'], 'false');
});

test('render (Task 10c g): a chip with an emoji puts it in its own decorative element before the label', () => {
  const markup = String(render({ items: [{ emoji: '🌙', label: 'luna', value: 2 }] }));
  assert.match(markup, /<span class="c-emoji" aria-hidden="true">🌙<\/span><span>luna<\/span><\/button>/);
});

test('hashtagChip (Task 10c h): links to X\'s hashtag search through the allowlist, in a new tab, noopener noreferrer, with the "search on X" tooltip; a plain chip stays a span', () => {
  const markup = String(render({ items: [hashtagChip('SolLuna Day'), { label: 'live' }] }));
  assert.match(markup, /<a class="chip c-chips__chip" href="https:\/\/x\.com\/hashtag\/SolLuna%20Day" target="_blank" rel="noopener noreferrer" title="search on X">#SolLuna Day<\/a>/);
  assert.match(markup, /<span class="chip c-chips__chip">live<\/span>/);
  assert.equal(hashtagChip('ไทย').href, `https://x.com/hashtag/${encodeURIComponent('ไทย')}`);
});
