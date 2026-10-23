// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { render, bind } from '../../public/js/components/cast.js';
import { FakeEl } from '../helpers/fakeDom.js';

test('cast: a person chip shows emoji + visible name and carries data-c', () => {
  /** @type {import('../../src/http/contracts.js').CastVM[]} */
  const cast = [{ kind: 'person', id: 1, emoji: '🧡', name: 'sol', colour: '#ff8a3d', igHandle: 'sol' }];
  const markup = String(render({ cast }));
  assert.match(markup, /data-c="#ff8a3d"/);
  assert.match(markup, /🧡/);
  assert.match(markup, />\s*sol\s*<\/span>/);
});

test('cast: a role chip has no colour', () => {
  /** @type {import('../../src/http/contracts.js').CastVM[]} */
  const cast = [{ kind: 'role', role: 'host', emoji: '🦁', name: 'host' }];
  const markup = String(render({ cast }));
  assert.ok(!markup.includes('data-c='));
});

test('bind: sets --c from a valid data-c, via the shared applyColours() validation', () => {
  const chip = new FakeEl({ 'data-c': '#9b6cff' });
  const root = new FakeEl({}, [chip]);
  bind(root);
  assert.equal(chip.styleProps['--c'], '#9b6cff');
});

test('bind: an invalid data-c is never applied', () => {
  const chip = new FakeEl({ 'data-c': 'red; background:url(x)' });
  const root = new FakeEl({}, [chip]);
  bind(root);
  assert.equal(chip.styleProps['--c'], undefined);
});

test('CSS (Task 10c g): the cast chip is its content plus the chip padding tokens, no fixed height, emoji 0.3em from the name', () => {
  const css = readFileSync('src/styles/components/cast.css', 'utf8');
  const rule = /\.c-cast__chip\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(rule, /padding:\s*var\(--chip-pad-y\)\s+var\(--chip-pad-x\)/);
  assert.match(rule, /gap:\s*0\.3em/);
  assert.doesNotMatch(rule, /(^|[^-])(min-)?height:/);
});
