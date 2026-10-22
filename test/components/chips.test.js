// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { render, bind } from '../../public/js/components/chips.js';
import { FakeEl } from '../helpers/fakeDom.js';

test('chips: renders each label, marks the active one, escapes text', () => {
  const markup = String(render({ items: [{ label: '<b>all</b>', active: true }, { label: 'luna', colour: '#9b6cff' }] }));
  assert.ok(!markup.includes('<b>all</b>'));
  assert.match(markup, /&lt;b&gt;all&lt;\/b&gt;/);
  assert.match(markup, /c-chips__chip--on"[^>]*>&lt;b&gt;all&lt;\/b&gt;/);
  assert.match(markup, /data-c="#9b6cff"/);
});

test('chips: a chip with `value` is a real <button> (native Enter/Space activation), with aria-pressed reflecting active and data-value', () => {
  const markup = String(render({ items: [{ label: 'sol', active: true, value: 1 }, { label: 'luna', active: false, value: 2 }] }));
  assert.match(markup, /<button type="button" class="c-chips__chip c-chips__chip--on" aria-pressed="true" data-value="1">sol<\/button>/);
  assert.match(markup, /<button type="button" class="c-chips__chip" aria-pressed="false" data-value="2">luna<\/button>/);
});

test('chips: a chip with no `value` (a display-only pill) stays a <span>, with no aria-pressed', () => {
  const markup = String(render({ items: [{ label: 'show / interview' }] }));
  assert.match(markup, /<span class="c-chips__chip">show \/ interview<\/span>/);
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

test('CSS: the chip is at least a 44px tap target', () => {
  const css = readFileSync('src/styles/components/chips.css', 'utf8');
  assert.match(css, /\.c-chips__chip\s*\{[^}]*min-height:\s*44px/);
});
