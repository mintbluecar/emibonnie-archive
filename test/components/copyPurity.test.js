// @ts-check
/**
 * Guards the "components... never contain literal UI text (t() only)"
 * rule (task-2-brief.md, "Rulings binding this task" #2): no copy string
 * of 4+ characters may appear as literal text-node content in a
 * component or kind-UI source file -- only as the *result* of a `t()`
 * call. Uses ESLint's own parser (via a throwaway collector rule) to walk
 * every template literal's `TemplateElement` chunks, so nested
 * `` html`…` `` calls (which this codebase uses throughout) are handled
 * correctly rather than by a naive backtick-pairing regex.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { Linter } from 'eslint';

/** @param {string} dir @returns {string[]} */
function jsFilesIn(dir) {
  if (!existsSync(dir)) return [];
  /** @type {string[]} */
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...jsFilesIn(full));
    else if (entry.name.endsWith('.js') && entry.name !== '_registry.js') results.push(full);
  }
  return results;
}

/** Every `TemplateElement` raw chunk in `source`. @param {string} source @returns {string[]} */
function templateChunksOf(source) {
  const linter = new Linter();
  /** @type {string[]} */
  const chunks = [];
  const rule = { create() { return { TemplateElement: (/** @type {any} */ node) => chunks.push(node.value.raw) }; } };
  linter.verify(source, {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    plugins: { local: { rules: { collect: rule } } },
    rules: { 'local/collect': 'error' },
  });
  return chunks;
}

/** Literal text-node segments (attributes and `${…}` holes excluded) across `chunks`. @param {string[]} chunks @returns {string[]} */
function textNodesOf(chunks) {
  return chunks.flatMap((chunk) => [...chunk.matchAll(/>([^<>{}]*)</g)].map((m) => m[1]));
}

/** @param {Record<string,string>} copy @returns {string[]} */
function longValues(copy) {
  return Object.values(copy).filter((v) => v.length >= 4);
}

function mergedCopy() {
  const defaults = JSON.parse(readFileSync('src/site/copyDefaults.json', 'utf8'));
  const translation = JSON.parse(readFileSync('src/kinds/translation/copy.json', 'utf8'));
  return { ...defaults, ...translation };
}

test('copy purity: every copy value appears only via t(), never as literal text in a component/kind-UI template', () => {
  const copyValues = longValues(mergedCopy());
  const files = [...jsFilesIn('public/js/components'), ...jsFilesIn('public/js/kinds')];
  assert.ok(files.length >= 10, 'expected the full set of component/kind-UI files to be scanned');

  /** @type {string[]} */
  const offenders = [];
  for (const file of files) {
    const textNodes = textNodesOf(templateChunksOf(readFileSync(file, 'utf8')));
    for (const node of textNodes) {
      for (const value of copyValues) {
        if (node.includes(value)) offenders.push(`${file}: literal text node contains copy value '${value}'`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('copy purity: the scan actually catches a hardcoded copy value (sanity check on the matcher itself)', () => {
  const chunks = templateChunksOf("const x = html`<span>FAN-MADE</span>`;");
  const nodes = textNodesOf(chunks);
  assert.ok(nodes.some((n) => n.includes('FAN-MADE')));
});
