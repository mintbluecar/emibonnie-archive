// @ts-check
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_DEFAULTS_PATH = fileURLToPath(new URL('./copyDefaults.json', import.meta.url));
const KINDS_DIR = fileURLToPath(new URL('../kinds/', import.meta.url));

/**
 * @param {string} filePath
 * @returns {Record<string, string>}
 */
function readCopyFile(filePath) {
  if (!existsSync(filePath)) return {};
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/**
 * Every `src/kinds/<kind>/copy.json`, sorted by kind name.
 * @returns {Record<string, string>[]}
 */
function readKindCopyFiles() {
  if (!existsSync(KINDS_DIR)) return [];
  return readdirSync(KINDS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => readCopyFile(path.join(KINDS_DIR, name, 'copy.json')));
}

/**
 * Merges engine defaults, then every kind's `copy.json`, then the site's
 * own `copy.json`. The site's copy may only override a key that already
 * exists from the engine or a kind; introducing a new key there is an
 * error, so user-facing wording stays within the engine's namespaced keys
 * (`nav.home`, `badge.fanMade`, …).
 * @param {string} [dir]
 * @returns {Record<string, string>}
 */
export function loadCopy(dir = process.env.SITE_DIR ?? 'site') {
  /** @type {Record<string, string>} */
  const known = { ...readCopyFile(ENGINE_DEFAULTS_PATH) };
  for (const kindCopy of readKindCopyFiles()) Object.assign(known, kindCopy);

  const siteCopyPath = path.join(dir, 'copy.json');
  const siteCopy = readCopyFile(siteCopyPath);
  const unknownKeys = Object.keys(siteCopy).filter((key) => !(key in known));
  if (unknownKeys.length > 0) {
    throw new Error(`unknown copy key(s) in ${siteCopyPath}: ${unknownKeys.join(', ')}`);
  }

  return { ...known, ...siteCopy };
}
