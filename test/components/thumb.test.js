// @ts-check
/**
 * Task 11: a card's thumbnail is lazy by default; the first few cards of
 * a list (the first screen) ask for theirs eagerly, at high priority.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
// Dynamic import: see test/components/header.test.js for why.
const { render } = await import('../../public/js/components/thumb.js');

const THUMB = { url: 'https://pbs.twimg.com/media/x?format=jpg&name=360x360', width: 4, height: 3, video: false };

test('thumb.render: lazy by default; { eager: true } gives loading="eager" fetchpriority="high"', () => {
  const lazy = String(render(THUMB));
  assert.match(lazy, /loading="lazy" decoding="async">/);
  assert.ok(!lazy.includes('fetchpriority'));
  const eager = String(render(THUMB, { eager: true }));
  assert.match(eager, /loading="eager" fetchpriority="high" decoding="async">/);
  assert.ok(!eager.includes('loading="lazy"'));
  assert.match(eager, /src="https:\/\/pbs\.twimg\.com\/media\/x\?format=jpg&amp;name=360x360"/);
});
