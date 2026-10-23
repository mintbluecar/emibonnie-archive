// @ts-check
/**
 * Task 10b guard: every internal link path written into `public/js`
 * resolves to a real route. The footer once linked `/privacy/` while
 * the only route is `/privacy` (vercel.json's rewrites come from
 * `src/pages.js`), so the live privacy page 404'd. Page paths now come
 * from `public/js/core/routes.js` (pinned in test/core/routes.test.js);
 * this scans the source for any path typed out directly anyway -- an
 * `href="/…"` in a template, an `href: '/…'` property, or a
 * `location`/`history` assignment -- and requires each to be a
 * `src/pages.js` route (no trailing slash), `/api`, or a kind's item
 * `urlPrefix`. Task 10d: `/search` is no longer a page -- only a
 * redirect home for old links -- so a link to it fails.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pages } from '../../src/pages.js';
import { kindsRegistry } from '../../src/kinds/_registry.js';

const PUBLIC_JS = fileURLToPath(new URL('../../public/js/', import.meta.url));

/** Literal paths: up to the closing quote, stopping at an interpolation. */
const PATTERNS = [
  /href="(\/[^"$]*)/g,
  /href:\s*['"`](\/[^'"`$]*)/g,
  /location(?:\.href)?\s*=\s*['"`](\/[^'"`$]*)/g,
  /location\.(?:assign|replace)\(\s*['"`](\/[^'"`$]*)/g,
  /history\.(?:pushState|replaceState)\([^)]*?['"`](\/[^'"`$]*)/g,
];

/**
 * Fix round 1, M3: any template literal that starts with a typed path
 * (`` `/search?${…}` ``), outside routes.js -- the one file that may spell
 * page paths. Matches up to the first interpolation or closing backtick.
 */
const TEMPLATE_PATH = /`(\/[A-Za-z][^`$]*)/g;

/** Code only: block and line comments (which quote paths in prose) removed. @param {string} source @returns {string} */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** @param {string} dir @returns {string[]} */
function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return entry.name.endsWith('.js') && entry.name !== '_registry.js' ? [full] : [];
  });
}

/** @param {string} source @returns {string[]} */
export function literalPaths(source) {
  const code = stripComments(source);
  return PATTERNS.flatMap((pattern) => [...code.matchAll(pattern)].map((m) => m[1]));
}

/**
 * Template literals starting with a typed path, outside routes.js. Only
 * API calls may be built this way; a page path must come from a
 * routes.js constant or helper (`searchHref`, `eventHref`, …).
 * @param {string} source @returns {string[]}
 */
export function handTypedPagePaths(source) {
  return [...stripComments(source).matchAll(TEMPLATE_PATH)].map((m) => m[1]).filter((p) => !p.startsWith('/api/'));
}

const PAGE_PATTERNS = pages.map((p) => new RegExp(`^${p.path.replace(/:\w+/g, '[^/]+')}$`));
const KIND_PREFIXES = Object.values(kindsRegistry).map((kind) => /** @type {any} */ (kind).urlPrefix);

/** @param {string} raw @returns {boolean} */
export function resolves(raw) {
  const pathOnly = raw.split(/[?#]/)[0];
  if (pathOnly === '/api' || pathOnly.startsWith('/api/')) return true;
  if (KIND_PREFIXES.some((prefix) => pathOnly.startsWith(prefix) && pathOnly.length >= prefix.length)) return true;
  return PAGE_PATTERNS.some((pattern) => pattern.test(pathOnly));
}

test('the guard itself: a trailing-slash page path, an unknown path and a bare /soon fail; real routes pass', () => {
  assert.deepEqual(literalPaths('html`<a href="/privacy/">x</a>`; x = { href: \'/me/\' }; window.location.href = \'/soon\';'), ['/privacy/', '/me/', '/soon']);
  for (const bad of ['/privacy/', '/about/', '/takedown/', '/add/', '/me/', '/soon', '/nope', '/search', '/search?filters=1']) assert.equal(resolves(bad), false, bad);
  for (const good of ['/', '/?q=x', '/privacy', '/about', '/takedown', '/add', '/me', '/api/search', '/e/x?q=hi', '/e/x', '/p/x', '/tl/x', `${KIND_PREFIXES[0]}123`]) {
    assert.equal(resolves(good), true, good);
  }
});

test('fix round 1, M3: a hand-typed page path in a template literal is caught, even one that resolves; API calls and comments are not', () => {
  assert.deepEqual(handTypedPagePaths('const href = `/search?${q}`;'), ['/search?']);
  assert.deepEqual(handTypedPagePaths('const href = `/p/${ig}`;'), ['/p/']);
  assert.deepEqual(handTypedPagePaths('const u = `/api/item/${id}`;'), []);
  assert.deepEqual(handTypedPagePaths('/** e.g. `/search?q=x` */\n// see `/nowhere`\nconst a = 1;'), []);
});

test('every internal link path typed in public/js resolves to a route (Task 10b)', () => {
  /** @type {string[]} */
  const broken = [];
  for (const file of jsFiles(PUBLIC_JS)) {
    const source = readFileSync(file, 'utf8');
    for (const found of literalPaths(source)) {
      if (!resolves(found)) broken.push(`${path.relative(PUBLIC_JS, file)}: ${found}`);
    }
    if (path.basename(file) === 'routes.js') continue;
    for (const found of handTypedPagePaths(source)) broken.push(`${path.relative(PUBLIC_JS, file)}: hand-typed page path \`${found}…\` (use public/js/core/routes.js)`);
  }
  assert.deepEqual(broken, []);
});
