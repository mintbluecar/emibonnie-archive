// @ts-check
/**
 * Styling system Task 5 (spec "6. Enforcement"): every static class
 * token inside a `class="..."` attribute in `public/js/**\/*.js` or
 * `dev/styleguide/index.html.tmpl` must match a class selector somewhere
 * in `src/styles/**\/*.css`, and every class selector in that CSS must
 * be used somewhere -- except:
 *
 *   (a) a short, explicit list of classes built from a dynamic prefix
 *       (e.g. `c-import__state--${state}`), which a literal scan can
 *       only ever see as the truncated prefix; and
 *   (b) a handful of classes outside the engine's own naming convention
 *       (a third-party embed's required classname), named explicitly
 *       below rather than silently ignored.
 *
 * Until Task 15, a third exception excused any class whose block was
 * still styled by a file on `scripts/stylelintPending.json` (today's
 * unstyled controls, before their migration task). Every component is
 * migrated now, that file is gone, and so is the exception.
 *
 * Task 15 (spec "7. Docs and the style guide") adds a second pair of
 * tests below: every class and custom property named in `STYLING.md`'s
 * fenced code blocks must be real, so the doc can't silently drift from
 * the CSS it documents.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkFiles } from '../../scripts/buildChecks.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STYLING_MD_PATH = path.join(REPO_ROOT, 'STYLING.md');
const TOKENS_CSS_PATH = path.join(REPO_ROOT, 'src/styles/tokens.css');

/**
 * Dynamic class families a literal scan only ever sees as their
 * truncated prefix (the state/position right after it is interpolated,
 * `${...}`, with no separating space) -- exception (a).
 * @type {string[]}
 */
const DYNAMIC_PREFIXES = ['c-import__state--', 'c-header__tagline--'];

/**
 * Exception (b), each named for a reason, not swept in by a looser rule.
 * @type {Record<string, string>}
 */
const NON_ENGINE_CLASSES = {
  'twitter-tweet': "X's own required embed classname (public/js/components/sourceEmbed.js); never styled by the engine",
  'twitter-tweet-rendered': "the container X's widgets.js puts in the blockquote's place (never in our markup); sourceEmbed.css scales it",
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

function loadFixtures() {
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

  return { selectorFiles, usedTokens };
}

test('every static class used in markup matches a CSS selector or a named exception', () => {
  const { selectorFiles, usedTokens } = loadFixtures();
  const failures = [];
  for (const [token, files] of usedTokens) {
    if (selectorFiles.has(token)) continue;
    if (DYNAMIC_PREFIXES.includes(token)) continue;
    if (Object.hasOwn(NON_ENGINE_CLASSES, token)) continue;
    failures.push(`"${token}" (used in ${[...files].join(', ')}) matches no CSS selector`);
  }
  assert.deepEqual(failures, []);
});

test('every CSS class selector is used in markup, a named dynamic family, or a named exception', () => {
  const { selectorFiles, usedTokens } = loadFixtures();
  const failures = [];
  for (const [selector, files] of selectorFiles) {
    if (usedTokens.has(selector)) continue;
    if (DYNAMIC_PREFIXES.some((prefix) => selector.startsWith(prefix))) continue;
    if (Object.hasOwn(NON_ENGINE_CLASSES, selector)) continue;
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

/**
 * Styling system Task 15 (spec "7. Docs and the style guide"): keeps
 * `STYLING.md` honest. A fenced code block's language tag and body.
 * @param {string} markdown @returns {{ lang: string, body: string }[]}
 */
function fencedBlocksOf(markdown) {
  return [...markdown.matchAll(/```(\w*)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1], body: m[2] }));
}

/**
 * Custom property names declared with `--name:` -- only at a declaration
 * boundary (start of line, `{`, `;` or whitespace), never mid-selector
 * like `.btn--sm:hover` (whose `m` before `:` would otherwise match).
 * @param {string} css @returns {Set<string>}
 */
function declaredTokensOf(css) {
  const names = new Set();
  for (const m of css.matchAll(/(?:^|[\s{;])(--[a-zA-Z][\w-]*)\s*:/gm)) names.add(m[1]);
  return names;
}

/** `declaredTokensOf`'s names, plus every `var(--name` reference. @param {string} css @returns {Set<string>} */
function tokenMentionsOf(css) {
  const names = declaredTokensOf(css);
  for (const m of css.matchAll(/var\(\s*(--[a-zA-Z][\w-]*)/g)) names.add(m[1]);
  return names;
}

test('STYLING.md: every class in an html code block is a real CSS selector', () => {
  const { selectorFiles } = loadFixtures();
  const markdown = readFileSync(STYLING_MD_PATH, 'utf8');
  const failures = [];
  for (const { lang, body } of fencedBlocksOf(markdown)) {
    if (lang !== 'html') continue;
    for (const token of classTokensOf(body)) {
      if (!selectorFiles.has(token)) failures.push(`".${token}" (STYLING.md) matches no CSS selector`);
    }
  }
  assert.deepEqual(failures, []);
});

test('STYLING.md: every custom property in a css code block is declared in tokens.css', () => {
  const markdown = readFileSync(STYLING_MD_PATH, 'utf8');
  const declared = declaredTokensOf(readFileSync(TOKENS_CSS_PATH, 'utf8'));
  const failures = [];
  for (const { lang, body } of fencedBlocksOf(markdown)) {
    if (lang !== 'css') continue;
    for (const token of tokenMentionsOf(body)) {
      if (!declared.has(token)) failures.push(`"${token}" (STYLING.md) is not declared in tokens.css`);
    }
  }
  assert.deepEqual(failures, []);
});
