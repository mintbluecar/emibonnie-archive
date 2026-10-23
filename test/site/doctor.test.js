// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runDoctor } from '../../scripts/doctor.js';

/** @returns {string} a temp repo root with just a `.nvmrc` matching this Node. */
function makeTempRepoRoot() {
  const dir = mkdtempSync(path.join(tmpdir(), 'fan-archive-doctor-'));
  writeFileSync(path.join(dir, '.nvmrc'), `${process.versions.node.split('.')[0]}\n`);
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  return dir;
}

test('doctor: no site/ prints the exact missing-site line and fails', () => {
  const repoRoot = makeTempRepoRoot();
  try {
    const { lines, ok } = runDoctor({ repoRoot, siteDir: 'site', env: {} });
    assert.equal(ok, false);
    assert.ok(
      lines.some((line) => line.symbol === '✗' && line.text === 'site/ missing — run npm run init-site'),
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('doctor: a valid site/ and DATABASE_URL pass those checks', () => {
  const repoRoot = makeTempRepoRoot();
  try {
    cpSync('examples/solluna', path.join(repoRoot, 'site'), { recursive: true });
    const { lines } = runDoctor({ repoRoot, siteDir: 'site', env: { DATABASE_URL: 'postgres://x' } });
    const bySymbol = (symbol) => lines.filter((line) => line.symbol === symbol);
    assert.ok(lines.find((line) => line.text === 'site/ exists' && line.symbol === '✓'));
    assert.ok(lines.find((line) => line.text === 'settings are valid' && line.symbol === '✓'));
    assert.ok(lines.find((line) => line.text.startsWith('env vars present') && line.symbol === '✓'));
    assert.equal(bySymbol('✗').length, 0);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('doctor: missing DATABASE_URL fails that check', () => {
  const repoRoot = makeTempRepoRoot();
  try {
    const { lines, ok } = runDoctor({ repoRoot, siteDir: 'site', env: {} });
    assert.equal(ok, false);
    assert.ok(lines.some((line) => line.symbol === '✗' && line.text.includes('DATABASE_URL')));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('doctor: no upstream remote is a neutral skip, not a ✗', () => {
  const repoRoot = makeTempRepoRoot();
  try {
    const { lines } = runDoctor({ repoRoot, siteDir: 'site', env: { DATABASE_URL: 'x' } });
    const upstreamLine = lines.find((line) => line.text.startsWith('engine version'));
    assert.equal(upstreamLine?.symbol, '·');
    assert.match(upstreamLine?.text ?? '', /no upstream remote/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test('latestTagOf: peeled annotated-tag lines (refs/tags/vX.Y.Z^{}) are stripped and deduped; the highest semver wins', async () => {
  const { latestTagOf } = await import('../../scripts/doctor.js');
  // `git ls-remote --tags` prints an annotated tag twice: the tag, and `<tag>^{}` for the commit it points at
  // (git-ls-remote docs, OUTPUT; gitrevisions: `<rev>^{}` dereferences the tag).
  const output = [
    'aaa1\trefs/tags/v0.10.0^{}',
    'aaa2\trefs/tags/v0.10.0',
    'bbb1\trefs/tags/v0.9.1',
    'ccc1\trefs/tags/not-a-version',
    'ddd1\trefs/tags/v0.2.0^{}',
    '',
  ].join('\n');
  assert.equal(latestTagOf(output), 'v0.10.0');
  assert.equal(latestTagOf('eee\trefs/tags/v0.1.0^{}\nfff\trefs/tags/v0.1.0\n'), 'v0.1.0');
  assert.equal(latestTagOf(''), null);
  assert.equal(latestTagOf('ggg\trefs/tags/release-candidate\n'), null);
});

test('compareUpstreamVersion: the local version equal to the newest (peeled) tag is a ✓, an older one a ✗ naming the tag', async () => {
  const { compareUpstreamVersion } = await import('../../scripts/doctor.js');
  const repoRoot = makeTempRepoRoot();
  try {
    assert.equal(compareUpstreamVersion('a\trefs/tags/v0.1.0^{}\nb\trefs/tags/v0.1.0\n', repoRoot).symbol, '✓');
    const behind = compareUpstreamVersion('a\trefs/tags/v0.2.0^{}\nb\trefs/tags/v0.2.0\nc\trefs/tags/v0.1.0\n', repoRoot);
    assert.equal(behind.symbol, '✗');
    assert.match(behind.text, /behind upstream v0\.2\.0 — git fetch upstream --tags && git merge v0\.2\.0/);
    assert.doesNotMatch(behind.text, /\^\{\}/);
    assert.equal(compareUpstreamVersion('a\trefs/tags/v0.0.9\n', repoRoot).symbol, '✓', 'ahead of upstream is not a problem');
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
