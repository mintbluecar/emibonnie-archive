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
import { TREE_HASH_PATHS } from '../../scripts/treeHashConfig.js';

test('the guard covers the engine trees, the page templates (under src/), the tests, the docs, a site repo\'s site/ and root vercel.json', () => {
  for (const p of ['src', 'public', 'api', 'scripts', 'test', 'e2e', 'examples', 'docs', 'site', 'vercel.json']) assert.ok(TREE_HASH_PATHS.includes(p), p);
});

test('hashTree takes files as well as directories (fix round 1, M2): a rewritten vercel.json is caught', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fan-archive-hash-'));
  try {
    const paths = [path.join(root, 'src'), path.join(root, 'vercel.json')];
    const absent = hashTree(paths);
    writeFileSync(path.join(root, 'vercel.json'), '{"regions":["sin1"]}\n');
    const written = hashTree(paths);
    assert.notEqual(written, absent, 'a vercel.json appearing is caught');
    writeFileSync(path.join(root, 'vercel.json'), '{"regions":["iad1"]}\n');
    assert.notEqual(hashTree(paths), written, 'a rewritten vercel.json is caught');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
