// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render, bind } from '../../public/js/components/personHeader.js';
import { FakeEl } from '../helpers/fakeDom.js';

test('personHeader: shows emoji, name, handle, and data-c for the colour', () => {
  const markup = String(render({ person: { id: 1, name: 'sol', emoji: '🧡', colour: '#ff8a3d', igHandle: 'solsunny', featured: true } }));
  assert.match(markup, /data-c="#ff8a3d"/);
  assert.match(markup, /<h1 class="c-person-header__name">sol<\/h1>/);
  assert.match(markup, /@solsunny/);
});

test('personHeader: no igHandle means no handle line', () => {
  const markup = String(render({ person: { id: 1, name: 'sol', emoji: '🧡', colour: '#ff8a3d', igHandle: null, featured: false } }));
  assert.ok(!markup.includes('c-person-header__handle'));
});

test('bind: sets --c on the mounted .c-person-header (a descendant of the element bind() is called with)', () => {
  const coloured = new FakeEl({ 'data-c': '#ff8a3d' });
  const mountPoint = new FakeEl({}, [coloured]);
  bind(mountPoint);
  assert.equal(coloured.styleProps['--c'], '#ff8a3d');
});
