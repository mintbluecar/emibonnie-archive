// @ts-check
/** `npm run e2e:site`'s guard (Task 9a item 1): skip in the engine, fail clearly without a seed. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { siteE2eBlocker } from '../../scripts/e2eSite.js';

test('no site folder: skipped, with a message pointing at init-site and npm run e2e', () => {
  const blocker = siteE2eBlocker(path.join(tmpdir(), 'fan-archive-no-such-site'));
  assert.equal(blocker?.skip, true);
  assert.match(blocker?.message ?? '', /skipped.*init-site.*npm run e2e/s);
});

test('a site without seed/maps.json: not skipped but refused; with one: runs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fan-archive-e2e-site-'));
  try {
    cpSync('examples/solluna/site.json', path.join(root, 'site.json'));
    assert.deepEqual({ skip: siteE2eBlocker(root)?.skip, needsSeed: /seed\/maps\.json/.test(siteE2eBlocker(root)?.message ?? '') }, { skip: false, needsSeed: true });
    cpSync('examples/solluna/seed', path.join(root, 'seed'), { recursive: true });
    assert.equal(siteE2eBlocker(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
