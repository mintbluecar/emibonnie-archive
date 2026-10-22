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
