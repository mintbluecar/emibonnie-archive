// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render, bind } from '../../public/js/components/chips.js';
import { FakeEl } from '../helpers/fakeDom.js';

test('chips: renders each label, marks the active one, escapes text', () => {
  const markup = String(render({ items: [{ label: '<b>all</b>', active: true }, { label: 'luna', colour: '#9b6cff' }] }));
  assert.ok(!markup.includes('<b>all</b>'));
  assert.match(markup, /&lt;b&gt;all&lt;\/b&gt;/);
  assert.match(markup, /c-chips__chip--on"[^>]*>&lt;b&gt;all&lt;\/b&gt;/);
  assert.match(markup, /data-c="#9b6cff"/);
});

test('bind: sets --c from data-c', () => {
  const chip = new FakeEl({ 'data-c': '#b5651d' });
  const root = new FakeEl({}, [chip]);
  bind(root);
  assert.equal(chip.styleProps['--c'], '#b5651d');
});
