// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
// Dynamic import: see test/components/header.test.js for why.
const { render } = await import('../../public/js/components/footer.js');

test('footer: has links for about, privacy and takedown, plus the unofficial note', () => {
  const markup = String(render());
  assert.match(markup, /<a class="meta tap-link" href="\/about">About<\/a>/);
  assert.match(markup, /<a class="meta tap-link" href="\/privacy">Privacy<\/a>/);
  assert.match(markup, /<a class="meta tap-link" href="\/takedown">Takedown<\/a>/);
  assert.match(markup, /Unofficial, not affiliated with the artists or their agency/);
});
