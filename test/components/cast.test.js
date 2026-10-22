// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
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

test('bind: sets --c from data-c', () => {
  const chip = new FakeEl({ 'data-c': '#9b6cff' });
  const root = new FakeEl({}, [chip]);
  bind(root);
  assert.equal(chip.styleProps['--c'], '#9b6cff');
});
