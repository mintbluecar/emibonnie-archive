// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { FakeEl } from '../helpers/fakeDom.js';
// Dynamic import: see test/components/header.test.js for why.
const { render, bind, hashtagChip } = await import('../../public/js/components/chips.js');

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

test('CSS (Task 10c g): a chip is its content plus the --chip-pad-y/--chip-pad-x tokens, never a fixed or minimum height; a clickable one keeps a >= 24px hit area', () => {
  const css = readFileSync('src/styles/components/chips.css', 'utf8');
  const rule = /\.c-chips__chip\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /padding:\s*var\(--chip-pad-y\)\s+var\(--chip-pad-x\)/);
  assert.match(rule, /gap:\s*0\.3em/);
  assert.doesNotMatch(rule, /(^|[^-])(min-)?height:/);
  assert.match(css, /button\.c-chips__chip::before[^{]*\{[^}]*min-height:\s*24px/);
  assert.match(css, /\.c-chips\s*\{[^}]*gap:\s*6px 4px/, 'wrapped rows get a row gap (d)');
});

test('render (Task 10c g): a chip with an emoji puts it in its own decorative element before the label', () => {
  const markup = String(render({ items: [{ emoji: '🌙', label: 'luna', value: 2 }] }));
  assert.match(markup, /<span class="c-chips__emoji" aria-hidden="true">🌙<\/span><span>luna<\/span><\/button>/);
});

test('hashtagChip (Task 10c h): links to X\'s hashtag search through the allowlist, in a new tab, noopener noreferrer, with the "search on X" tooltip; a plain chip stays a span', () => {
  const markup = String(render({ items: [hashtagChip('SolLuna Day'), { label: 'live' }] }));
  assert.match(markup, /<a class="c-chips__chip" href="https:\/\/x\.com\/hashtag\/SolLuna%20Day" target="_blank" rel="noopener noreferrer" title="search on X">#SolLuna Day<\/a>/);
  assert.match(markup, /<span class="c-chips__chip">live<\/span>/);
  assert.equal(hashtagChip('ไทย').href, `https://x.com/hashtag/${encodeURIComponent('ไทย')}`);
});
