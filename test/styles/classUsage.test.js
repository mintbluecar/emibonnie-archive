// @ts-check
/**
 * Styling system Task 5 (spec "6. Enforcement"): every static class
 * token inside a `class="..."` attribute in `public/js/**\/*.js` or
 * `dev/styleguide/index.html.tmpl` must match a class selector somewhere
 * in `src/styles/**\/*.css`, and every class selector in that CSS must
 * be used somewhere -- except:
 *
 *   (a) a class whose block (`c-<block>`/`k-<block>`, the text up to its
 *       first `__` or `--`) is styled by a file still on
 *       `scripts/stylelintPending.json`: today's unstyled controls
 *       (`.c-import__more`, ...) stay that way
 *       until their migration task, so they pass here too -- the same
 *       list `stylelintPending.test.js` keeps honest shrinks this
 *       exception as components migrate;
 *   (b) a short, explicit list of classes built from a dynamic prefix
 *       (e.g. `c-import__state--${state}`), which a literal scan can
 *       only ever see as the truncated prefix; and
 *   (c) a handful of classes outside the engine's own naming convention
 *       (a third-party embed's required classname; two dead markers in
 *       bubbles.js with no CSS rule, left for that file's own migration
 *       task), named explicitly below rather than silently ignored.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkFiles } from '../../scripts/buildChecks.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Dynamic class families a literal scan only ever sees as their
 * truncated prefix (the state/position right after it is interpolated,
 * `${...}`, with no separating space) -- exception (b).
 * @type {string[]}
 */
const DYNAMIC_PREFIXES = ['c-import__state--', 'c-header__tagline--'];

/**
 * Exception (c), each named for a reason, not swept in by a looser rule.
 * @type {Record<string, string>}
 */
const NON_ENGINE_CLASSES = {
  'twitter-tweet': "X's own required embed classname (public/js/components/sourceEmbed.js); never styled by the engine",
  msg: 'bubbles.js: a dead marker on the continuation bubble with no CSS rule, left for bubbles.css\'s own migration task',
  cont: 'bubbles.js: a dead marker on the continuation bubble with no CSS rule, left for bubbles.css\'s own migration task',
};

/** @param {string} rel path relative to the repo root, forward-slashed */
function relOf(absPath) {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

/** Every `.class` token in a CSS source, comments stripped. @param {string} css @returns {string[]} */
function classSelectorsOf(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
}

/**
 * Every static class token inside `class="..."` attributes in one
 * source: the literal segments once every `${...}` hole is blanked out,
 * whitespace-split. A hole never contains a nested `${`, checked by
 * `classAttrsAreShallow.test` below, so blanking the first `}` closes it.
 * @param {string} source @returns {string[]}
 */
function classTokensOf(source) {
  const tokens = [];
  for (const m of source.matchAll(/class="([^"]*)"/g)) {
    const literal = m[1].replace(/\$\{[^}]*\}/g, ' ');
    tokens.push(...literal.split(/\s+/).filter(Boolean));
  }
  return tokens;
}

/** The block a class token belongs to: the text up to its first `__` or `--`. @param {string} token @returns {string} */
function blockOf(token) {
  const idx = token.search(/__|--/);
  return idx === -1 ? token : token.slice(0, idx);
}

/** @param {string} selector @param {string} block @returns {boolean} */
function sameBlock(selector, block) {
  return selector === block || selector.startsWith(`${block}__`) || selector.startsWith(`${block}--`);
}

function loadFixtures() {
  const pending = new Set(
    /** @type {string[]} */ (JSON.parse(readFileSync(path.join(REPO_ROOT, 'scripts/stylelintPending.json'), 'utf8'))),
  );

  /** @type {Map<string, Set<string>>} selector -> the files that define it */
  const selectorFiles = new Map();
  for (const { path: filePath, text } of walkFiles(path.join(REPO_ROOT, 'src/styles'), '.css')) {
    const rel = relOf(filePath);
    for (const selector of classSelectorsOf(text)) {
      if (!selectorFiles.has(selector)) selectorFiles.set(selector, new Set());
      selectorFiles.get(selector)?.add(rel);
    }
  }

  /** @type {Map<string, Set<string>>} token -> the files it's used in */
  const usedTokens = new Map();
  const jsSources = [...walkFiles(path.join(REPO_ROOT, 'public/js'), '.js'), {
    path: path.join(REPO_ROOT, 'dev/styleguide/index.html.tmpl'),
    text: readFileSync(path.join(REPO_ROOT, 'dev/styleguide/index.html.tmpl'), 'utf8'),
  }];
  for (const { path: filePath, text } of jsSources) {
    const rel = relOf(filePath);
    for (const token of classTokensOf(text)) {
      if (!usedTokens.has(token)) usedTokens.set(token, new Set());
      usedTokens.get(token)?.add(rel);
    }
  }

  return { pending, selectorFiles, usedTokens };
}

test('every static class used in markup matches a CSS selector, a pending block, or a named exception', () => {
  const { pending, selectorFiles, usedTokens } = loadFixtures();
  const failures = [];
  for (const [token, files] of usedTokens) {
    if (selectorFiles.has(token)) continue;
    if (DYNAMIC_PREFIXES.includes(token)) continue;
    if (Object.hasOwn(NON_ENGINE_CLASSES, token)) continue;
    const block = blockOf(token);
    const ownedByPending = [...selectorFiles].some(
      ([selector, definingFiles]) => sameBlock(selector, block) && [...definingFiles].some((f) => pending.has(f)),
    );
    if (ownedByPending) continue;
    failures.push(`"${token}" (used in ${[...files].join(', ')}) matches no CSS selector`);
  }
  assert.deepEqual(failures, []);
});

test('every CSS class selector is used in markup, pending, or a named dynamic family', () => {
  const { pending, selectorFiles, usedTokens } = loadFixtures();
  const failures = [];
  for (const [selector, files] of selectorFiles) {
    if (usedTokens.has(selector)) continue;
    if (DYNAMIC_PREFIXES.some((prefix) => selector.startsWith(prefix))) continue;
    if ([...files].some((f) => pending.has(f))) continue;
    failures.push(`".${selector}" (defined in ${[...files].join(', ')}) is never used in markup`);
  }
  assert.deepEqual(failures, []);
});

test('a class="..." attribute never nests a second ${ inside the first (classTokensOf\'s blanking assumption)', () => {
  const jsSources = [...walkFiles(path.join(REPO_ROOT, 'public/js'), '.js'), {
    path: path.join(REPO_ROOT, 'dev/styleguide/index.html.tmpl'),
    text: readFileSync(path.join(REPO_ROOT, 'dev/styleguide/index.html.tmpl'), 'utf8'),
  }];
  const nested = [];
  for (const { path: filePath, text } of jsSources) {
    for (const m of text.matchAll(/class="([^"]*)"/g)) {
      if (/\$\{[^}]*\$\{/.test(m[1])) nested.push(`${relOf(filePath)}: ${m[1]}`);
    }
  }
  assert.deepEqual(nested, []);
});
