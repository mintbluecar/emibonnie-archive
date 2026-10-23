// @ts-check
/**
 * Name-collision checks for `npm run new` (scripts/newPlans.js): URL
 * prefixes a new kind or page can't take, and identifiers a new route
 * can't be imported as. Each returns problems as strings; the scaffolder
 * refuses (writing nothing) when any is found.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { urlPrefixProblem } from '../src/kinds/defineKind.js';

/**
 * ECMAScript reserved words, strict-mode reserved words, and the two
 * names strict mode forbids as bindings: none can be a route's import
 * name or a page's function name.
 */
export const RESERVED_WORDS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else',
  'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new',
  'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'yield', 'let', 'static', 'implements', 'interface', 'package', 'private', 'protected', 'public',
  'arguments', 'eval',
]);

/** A page path's first segment as `/x/`, or null (`/`). @param {string} pagePath */
const prefixOfPath = (pagePath) => {
  const first = pagePath.split('/').find(Boolean);
  return first ? `/${first}/` : null;
};

/** Every kind folder's `urlPrefix` under `root` (read from its index.js). @param {string} root @returns {Map<string, string>} prefix -> kind */
function kindPrefixes(root) {
  const dir = path.join(root, 'src/kinds');
  /** @type {Map<string, string>} */
  const found = new Map();
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const index = path.join(dir, entry.name, 'index.js');
    if (!entry.isDirectory() || !existsSync(index)) continue;
    const prefix = /urlPrefix:\s*'([^']+)'/.exec(readFileSync(index, 'utf8'))?.[1];
    if (prefix) found.set(prefix, entry.name);
  }
  return found;
}

/** The first-segment prefixes of every page `root`'s src/pages.js lists. @param {string} root @returns {Set<string>} */
function pagePrefixes(root) {
  const file = path.join(root, 'src/pages.js');
  if (!existsSync(file)) return new Set();
  const paths = [...readFileSync(file, 'utf8').matchAll(/path:\s*'(\/[^']*)'/g)].map((m) => m[1]);
  return new Set(paths.map(prefixOfPath).filter((p) => p !== null));
}

/**
 * Why a new kind can't use `prefix`: reserved or owned (defineKind's own
 * check), or else already another kind folder's. One reason only: an
 * owned prefix is usually a kind folder's too, and saying so twice reads
 * as two problems.
 * @param {string} root @param {string} prefix @param {string} name
 * @returns {string[]}
 */
export function kindPrefixProblems(root, prefix, name) {
  const shared = urlPrefixProblem(prefix, name);
  if (shared) return [`${shared}; pick another name`];
  const taken = kindPrefixes(root).get(prefix);
  return taken && taken !== name ? [`urlPrefix ${prefix} is already the ${taken} kind's; pick another name`] : [];
}

/**
 * Why a new page can't live at `/<dash>`: its prefix is the API's, a
 * kind's (owned, or any kind folder's), or an existing page's.
 * @param {string} root @param {string} dash
 * @returns {string[]}
 */
export function pagePrefixProblems(root, dash) {
  const prefix = `/${dash}/`;
  if (prefix === '/api/') return ['/api is the API, not a page; pick another name'];
  const kind = kindPrefixes(root).get(prefix);
  if (kind) return [`/${dash} would shadow the ${kind} kind's item pages (${prefix}); pick another name`];
  const owned = urlPrefixProblem(prefix);
  if (owned?.includes('belongs to')) return [`/${dash} would shadow item pages: ${owned}; pick another name`];
  if (pagePrefixes(root).has(prefix)) return [`src/pages.js already has a page under ${prefix}; pick another name`];
  return [];
}

/**
 * Every name `src/routes/index.js` already binds (imports and
 * declarations), so a new route's import can't shadow or clash with one.
 * @param {string} text
 * @returns {Set<string>}
 */
export function boundNames(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const names = new Set();
  for (const [, list] of code.matchAll(/import\s*\{([^}]*)\}/g)) {
    for (const part of list.split(',').map((p) => p.trim()).filter(Boolean)) names.add(part.split(/\s+as\s+/).pop()?.trim());
  }
  for (const [, name] of code.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) names.add(name);
  for (const [, name] of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(name);
  return names;
}
