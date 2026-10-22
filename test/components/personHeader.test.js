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

test('bind: an invalid data-c is never applied, via the shared applyColours() validation', () => {
  const coloured = new FakeEl({ 'data-c': 'red; background:url(x)' });
  const mountPoint = new FakeEl({}, [coloured]);
  bind(mountPoint);
  assert.equal(coloured.styleProps['--c'], undefined);
});

test('personHeader (Task 9b): a centred card -- large emoji, name, handle, then the given counts line, with the given action (the search icon) inside it', () => {
  const markup = String(render({
    person: { id: 1, name: 'sol', emoji: '🧡', colour: '#ff8a3d', igHandle: 'solsunny', featured: true },
    counts: /** @type {any} */ ({ toString: () => '<p class="test-counts">in 3</p>' }),
    action: /** @type {any} */ ({ toString: () => '<a class="test-action" href="/search">s</a>' }),
  }));
  const order = ['c-person-header__emoji', 'c-person-header__name', 'c-person-header__handle', 'test-counts'].map((c) => markup.indexOf(c));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), `emoji, name, handle, counts in order (${order})`);
  const card = markup.slice(markup.indexOf('c-person-header"'), markup.lastIndexOf('</div>'));
  assert.ok(card.includes('test-action') && card.includes('test-counts'), 'both sit inside the card');
});
