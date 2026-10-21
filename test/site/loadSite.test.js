// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadSite, formatName, SiteConfigError } from '../../src/site/loadSite.js';

test('loadSite: loads and validates examples/solluna', () => {
  const site = loadSite('examples/solluna');
  assert.equal(site.name, 'solluna archive');
  assert.equal(site.featuredPeople[0].igHandle, 'solsunny');
});

test('loadSite: throws SiteConfigError listing every error', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fan-archive-site-'));
  try {
    writeFileSync(path.join(dir, 'site.json'), JSON.stringify({ name: 'x' }));
    assert.throws(
      () => loadSite(dir),
      (err) => {
        assert.ok(err instanceof SiteConfigError);
        assert.ok(err.errors.length > 1);
        assert.ok(err.errors.some((e) => e.startsWith('contactUrl:')));
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadSite: throws SiteConfigError when site.json is missing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fan-archive-site-'));
  try {
    assert.throws(() => loadSite(dir), SiteConfigError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('formatName: lowercases only when the site opts in', () => {
  const site = loadSite('examples/solluna'); // lowercaseNames: true
  assert.equal(formatName(site, 'SOL'), 'sol');
  assert.equal(formatName({ ...site, lowercaseNames: false }, 'SOL'), 'SOL');
});
