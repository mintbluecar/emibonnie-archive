// @ts-check
import { existsSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Finds the example folder to copy: the single folder under
 * `examplesDir`, or the one named `exampleName` when there are several
 * (or one is asked for by name regardless). Engine code never names a
 * fandom's example folder itself -- that would break `test/purity.test.js`
 * -- so this discovers it at runtime instead.
 * @param {string} examplesDir
 * @param {string} [exampleName]
 * @returns {{ ok: true, dir: string } | { ok: false, reason: string }}
 */
export function findExampleDir(examplesDir, exampleName) {
  const names = readdirSync(examplesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (exampleName) {
    if (!names.includes(exampleName)) {
      return { ok: false, reason: `no examples/${exampleName}/ folder (found: ${names.join(', ') || 'none'})` };
    }
    return { ok: true, dir: path.join(examplesDir, exampleName) };
  }
  if (names.length === 1) return { ok: true, dir: path.join(examplesDir, names[0]) };
  if (names.length === 0) return { ok: false, reason: `no example folder found under ${examplesDir}` };
  return {
    ok: false,
    reason: `multiple example folders under ${examplesDir} (${names.join(', ')}) — pass --example <name>`,
  };
}

/**
 * Copies an example folder to `site/`, once. Refuses, untouched, when the
 * target directory already exists.
 * @param {{ sourceDir?: string, examplesDir?: string, exampleName?: string, targetDir?: string }} [options]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function initSite(options = {}) {
  const targetDir = options.targetDir ?? process.env.SITE_DIR ?? 'site';
  if (existsSync(targetDir)) {
    return { ok: false, reason: `${targetDir} already exists -- init-site refuses to overwrite it` };
  }

  let sourceDir = options.sourceDir;
  if (!sourceDir) {
    const examplesDir = options.examplesDir ?? path.join(REPO_ROOT, 'examples');
    const found = findExampleDir(examplesDir, options.exampleName);
    if (!found.ok) return found;
    sourceDir = found.dir;
  }

  mkdirSync(path.dirname(targetDir), { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true });
  return { ok: true };
}

/**
 * @param {string[]} argv
 * @returns {string | undefined}
 */
function parseExampleArg(argv) {
  const index = argv.indexOf('--example');
  return index === -1 ? undefined : argv[index + 1];
}

function main() {
  const targetDir = process.env.SITE_DIR ?? 'site';
  const exampleName = parseExampleArg(process.argv.slice(2));
  const result = initSite({ exampleName });
  if (!result.ok) {
    console.error(`✗ ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ copied the example to ${targetDir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
