// @ts-check
/**
 * `npm test`'s source-tree guard (`pretest` hashes, `posttest` compares):
 * Task 9a item 8 moved the page sources to `src/html/` and made
 * `public/*.html` build output, and a site repo tracks `site/`. The
 * guard must still see a write to any of them.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashTree } from '../../scripts/hashTree.js';
import { TREE_HASH_DIRS } from '../../scripts/treeHashConfig.js';

test('the guard covers the engine trees, the page templates (under src/), the tests, the docs and a site repo\'s site/', () => {
  for (const dir of ['src', 'public', 'api', 'scripts', 'test', 'e2e', 'examples', 'docs', 'site']) assert.ok(TREE_HASH_DIRS.includes(dir), dir);
});

test('hashTree sees a nested write, and skips a directory that does not exist', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fan-archive-hash-'));
  try {
    mkdirSync(path.join(root, 'src/html'), { recursive: true });
    writeFileSync(path.join(root, 'src/html/index.html'), '{{asset:app.css}}');
    const dirs = ['src', 'site'].map((d) => path.join(root, d));
    const before = hashTree(dirs);
    assert.equal(hashTree(dirs), before, 'stable');
    writeFileSync(path.join(root, 'src/html/index.html'), '/build/app-1234.css');
    assert.notEqual(hashTree(dirs), before, 'a rewritten template is caught');
    const afterEdit = hashTree(dirs);
    mkdirSync(path.join(root, 'site'));
    writeFileSync(path.join(root, 'site/site.json'), '{}');
    assert.notEqual(hashTree(dirs), afterEdit, 'a write into site/ is caught once it exists');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
