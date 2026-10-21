// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initSite } from '../../scripts/initSite.js';

test('initSite: copies examples/solluna once, then refuses', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'fan-archive-initsite-'));
  const targetDir = path.join(tmp, 'site');
  try {
    const first = initSite({ sourceDir: 'examples/solluna', targetDir });
    assert.deepEqual(first, { ok: true });
    assert.ok(existsSync(path.join(targetDir, 'site.json')));
    const site = JSON.parse(readFileSync(path.join(targetDir, 'site.json'), 'utf8'));
    assert.equal(site.name, 'solluna archive');

    const second = initSite({ sourceDir: 'examples/solluna', targetDir });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.match(second.reason, /already exists/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
