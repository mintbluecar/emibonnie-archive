// @ts-check
/**
 * Task 9a item 7: "no capitalisation for names" means *people's* names,
 * and that is `site.lowercaseNames` (applied server-side by `formatName`,
 * src/site/loadSite.js, to person display names only). Engine CSS must
 * not lowercase anything on its own: copy is written in sentence case
 * (copyDefaults.json), and an event name keeps the case it was stored
 * with. The owner asked for lowercase names only, never lowercase UI.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES = fileURLToPath(new URL('../../src/styles/', import.meta.url));

/** @param {string} dir @returns {string[]} */
const cssFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
  e.isDirectory() ? cssFiles(path.join(dir, e.name)) : e.name.endsWith('.css') ? [path.join(dir, e.name)] : []
));

test('engine CSS never lowercases text: only people\'s names are lowercase, via lowercaseNames', () => {
  const lowercased = cssFiles(STYLES).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/([^{}]+)\{[^}]*text-transform:\s*lowercase/g)]
    .flatMap((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim())));
  assert.deepEqual(lowercased, []);
});

// Copy slotted into the middle of another string ("12 translations ·
// newest first", "theme: dark", "added by a fan"), so it stays lowercase;
// and a URL, which is never capitalised.
const INLINE = new Set([
  'add.urlPlaceholder',
  'search.newestFirst', 'search.bestFirst', 'theme.light', 'theme.dark', 'theme.system',
  'item.addedByFan', 'owner.fan',
  'import.status.queued', 'import.status.running', 'import.status.done', 'import.status.failed',
]);

test('copy is in sentence case: every default string starts with a capital, except the inline pieces', () => {
  const files = ['../../src/site/copyDefaults.json', ...readdirSync(fileURLToPath(new URL('../../src/kinds/', import.meta.url)))
    .map((kind) => `../../src/kinds/${kind}/copy.json`)];
  const lower = files.flatMap((file) => {
    let copy;
    try { copy = JSON.parse(readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')); } catch { return []; }
    return Object.entries(copy).filter(([key, text]) => !INLINE.has(key) && /^[^\p{L}{]*\p{Ll}/u.test(text)).map(([key]) => key);
  });
  assert.deepEqual(lower, []);
});
