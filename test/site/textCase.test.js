// @ts-check
/**
 * Task 9a item 7: "no capitalisation for names" means *people's* names,
 * and that is `site.lowercaseNames` (applied server-side by `formatName`,
 * src/site/loadSite.js, to person display names only). Engine CSS must
 * not lowercase anything else on its own: an event name keeps the case
 * it was stored with. The one exception is the home page's month heading
 * (spec: "small, bold, lowercase"), which is a date, not a name.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES = fileURLToPath(new URL('../../src/styles/', import.meta.url));
const ALLOWED = new Set(['.c-home-month__label']);

/** @param {string} dir @returns {string[]} */
const cssFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
  e.isDirectory() ? cssFiles(path.join(dir, e.name)) : e.name.endsWith('.css') ? [path.join(dir, e.name)] : []
));

test('engine CSS lowercases only the month heading, never a name (event-group labels keep their case)', () => {
  const lowercased = cssFiles(STYLES).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/([^{}]+)\{[^}]*text-transform:\s*lowercase/g)]
    .flatMap((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim())));
  assert.deepEqual(lowercased.filter((selector) => !ALLOWED.has(selector)), []);
});
