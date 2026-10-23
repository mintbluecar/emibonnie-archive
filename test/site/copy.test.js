// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCopy } from '../../src/site/copy.js';

test('loadCopy: site overrides apply over engine defaults', () => {
  const copy = loadCopy('examples/solluna');
  assert.equal(
    copy['footer.unofficial'],
    'unofficial, not affiliated with sol, luna, or their agency',
  );
  assert.equal(copy['nav.home'], 'home'); // untouched engine default
});

test('loadCopy: an unknown copy key throws', () => {
  assert.throws(
    () => loadCopy('test/fixtures/site-badcopy'),
    /unknown copy key/,
  );
});

test('loadCopy: a site with no copy.json just gets the engine defaults', () => {
  const copy = loadCopy('test/fixtures/site-alt');
  assert.equal(copy['nav.home'], 'home');
});
