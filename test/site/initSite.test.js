// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initSite, findExampleDir } from '../../scripts/initSite.js';

test('initSite: discovers the sole example under examples/ and copies it once, then refuses', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'fan-archive-initsite-'));
  const targetDir = path.join(tmp, 'site');
  try {
    // No sourceDir/examplesDir given: this falls through to the real
    // repo's examples/ folder, which today holds exactly one example.
    const first = initSite({ targetDir });
    assert.deepEqual(first, { ok: true });
    assert.ok(existsSync(path.join(targetDir, 'site.json')));
    const site = JSON.parse(readFileSync(path.join(targetDir, 'site.json'), 'utf8'));
    assert.equal(site.name, 'solluna archive');

    const second = initSite({ targetDir });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.match(second.reason, /already exists/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

/** @returns {string} a temp `examples/` dir with the given folder names, each empty. */
function makeExamplesDir(names) {
  const tmp = mkdtempSync(path.join(tmpdir(), 'fan-archive-examples-'));
  for (const name of names) mkdirSync(path.join(tmp, name), { recursive: true });
  return tmp;
}

test('findExampleDir: picks the single folder when there is only one', () => {
  const examplesDir = makeExamplesDir(['only-one']);
  try {
    assert.deepEqual(findExampleDir(examplesDir), { ok: true, dir: path.join(examplesDir, 'only-one') });
  } finally {
    rmSync(examplesDir, { recursive: true, force: true });
  }
});

test('findExampleDir: picks the named folder among several', () => {
  const examplesDir = makeExamplesDir(['alpha', 'beta']);
  try {
    assert.deepEqual(findExampleDir(examplesDir, 'beta'), { ok: true, dir: path.join(examplesDir, 'beta') });
  } finally {
    rmSync(examplesDir, { recursive: true, force: true });
  }
});

test('findExampleDir: fails with a --example hint when several exist and none is named', () => {
  const examplesDir = makeExamplesDir(['alpha', 'beta']);
  try {
    const result = findExampleDir(examplesDir);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /--example/);
  } finally {
    rmSync(examplesDir, { recursive: true, force: true });
  }
});

test('findExampleDir: fails when the named folder does not exist', () => {
  const examplesDir = makeExamplesDir(['alpha']);
  try {
    const result = findExampleDir(examplesDir, 'nope');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /no examples\/nope\/ folder/);
  } finally {
    rmSync(examplesDir, { recursive: true, force: true });
  }
});
