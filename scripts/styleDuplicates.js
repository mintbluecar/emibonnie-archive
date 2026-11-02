// @ts-check
/**
 * `npm run check`'s duplicate-rule step, run by `scripts/lintStyles.js`
 * after stylelint. A component rule fails when its body -- the exact set
 * of property-value pairs, 3+ of them, in the same media context --
 * repeats a rule in another component file or in a primitive. Two
 * primitives matching each other are fine (primitives are the shared
 * layer), and so are short rules (two declarations match by chance too
 * often to mean a copy).
 *
 * A real coincidence is marked with a comment directly before either
 * rule, `/* not shared: <reason> *\/`; the reason must not be empty. A
 * marked rule takes no part in the comparison.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STYLE_DIRS = [
  { dir: 'src/styles/components', primitive: false },
  { dir: 'src/styles/primitives', primitive: true },
];
const MIN_DECLARATIONS = 3;
const NOT_SHARED = /^not shared:\s*\S/;

/**
 * @typedef {{ path: string, text: string, primitive: boolean }} StyleSource
 * @typedef {{ path: string, selector: string }} RuleRef
 * @typedef {{ a: RuleRef, b: RuleRef, props: string[] }} Duplicate
 * @typedef {RuleRef & { primitive: boolean, props: string[] }} Entry
 */

/** @param {string} value */
const collapse = (value) => value.trim().replace(/\s+/g, ' ');

/** The at-rule chain a rule sits in, e.g. `@media (min-width: 860px)`. @param {import('postcss').Rule} rule */
function contextOf(rule) {
  const chain = [];
  for (let node = rule.parent; node && node.type !== 'root'; node = node.parent) {
    if (node.type === 'atrule') {
      const atRule = /** @type {import('postcss').AtRule} */ (node);
      chain.unshift(`@${atRule.name} ${collapse(atRule.params)}`);
    }
  }
  return chain.join(' ');
}

/** @param {import('postcss').Rule} rule */
function isMarkedNotShared(rule) {
  const prev = rule.prev();
  return prev?.type === 'comment' && NOT_SHARED.test(prev.text.trim());
}

/** @param {import('postcss').Rule} rule */
function declarationsOf(rule) {
  return /** @type {import('postcss').Declaration[]} */ (rule.nodes.filter((node) => node.type === 'decl'));
}

/**
 * Every comparable rule in `sources`, grouped by media context + body.
 * @param {StyleSource[]} sources
 * @returns {Map<string, Entry[]>}
 */
function groupRules(sources) {
  /** @type {Map<string, Entry[]>} */
  const groups = new Map();
  for (const source of sources) {
    postcss.parse(source.text).walkRules((rule) => {
      const decls = declarationsOf(rule);
      if (decls.length < MIN_DECLARATIONS || isMarkedNotShared(rule)) return;
      const pairs = decls.map((d) => `${d.prop.toLowerCase()}:${collapse(d.value)}${d.important ? ' !important' : ''}`);
      const key = `${contextOf(rule)}\n${[...new Set(pairs)].sort().join(';')}`;
      const props = [...new Set(decls.map((d) => d.prop.toLowerCase()))].sort();
      const entry = { path: source.path, selector: collapse(rule.selector), primitive: source.primitive, props };
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    });
  }
  return groups;
}

/**
 * Each component rule that repeats a rule in another file. Within a
 * group, the first primitive (or else the first rule) is the original;
 * every component rule from a different file is reported against it.
 * @param {StyleSource[]} sources
 * @returns {Duplicate[]}
 */
export function findDuplicates(sources) {
  /** @type {Duplicate[]} */
  const found = [];
  for (const entries of groupRules(sources).values()) {
    const original = entries.find((e) => e.primitive) ?? entries[0];
    for (const entry of entries) {
      if (entry.primitive || entry.path === original.path) continue;
      found.push({
        a: { path: entry.path, selector: entry.selector },
        b: { path: original.path, selector: original.selector },
        props: entry.props,
      });
    }
  }
  return found;
}

/** @param {Duplicate} d */
export function formatDuplicate({ a, b, props }) {
  return `${a.path} ${a.selector} repeats ${b.path} ${b.selector} (${props.join(', ')}). `
    + 'Use the existing class, or move the rule into src/styles/primitives/ and use it from both. See STYLING.md "Rules card".';
}

/**
 * This checkout's component and primitive CSS, paths relative to the repo.
 * @param {string} [repoRoot]
 * @returns {StyleSource[]}
 */
export function readStyleSources(repoRoot = REPO_ROOT) {
  return STYLE_DIRS.flatMap(({ dir, primitive }) => readdirSync(path.join(repoRoot, dir))
    .filter((name) => name.endsWith('.css'))
    .sort()
    .map((name) => ({
      path: `${dir}/${name}`,
      text: readFileSync(path.join(repoRoot, dir, name), 'utf8'),
      primitive,
    })));
}
