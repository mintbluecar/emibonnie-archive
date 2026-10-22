// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
// Dynamic import: see test/components/header.test.js for why.
const { render } = await import('../../public/js/components/tabBar.js');

test('tabBar: shows home, search, + add and me, each linking to its route', () => {
  const markup = String(render({ active: 'search' }));
  assert.match(markup, /href="\/"[^>]*>[\s\S]*?home/);
  assert.match(markup, /href="\/add\/"[^>]*>[\s\S]*?＋[\s\S]*?add/);
  assert.match(markup, /href="\/me\/"[^>]*>[\s\S]*?me/);
});

test('tabBar: marks only the active tab', () => {
  const markup = String(render({ active: 'search' }));
  const items = markup.split('<a').slice(1);
  const on = items.filter((item) => item.includes('c-tabbar__item--on'));
  assert.equal(on.length, 1);
  assert.match(on[0], /href="\/search"/);
});

test('tabBar: with no active tab, nothing is marked on', () => {
  const markup = String(render());
  assert.ok(!markup.includes('c-tabbar__item--on'));
});
