// @ts-check
import { existsSync, mkdirSync, cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Copies `examples/solluna/` to `site/`, once. Refuses, untouched, when
 * the target directory already exists.
 * @param {{ sourceDir?: string, targetDir?: string }} [options]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function initSite(options = {}) {
  const sourceDir = options.sourceDir ?? path.join(REPO_ROOT, 'examples/solluna');
  const targetDir = options.targetDir ?? process.env.SITE_DIR ?? 'site';

  if (existsSync(targetDir)) {
    return { ok: false, reason: `${targetDir} already exists -- init-site refuses to overwrite it` };
  }

  mkdirSync(path.dirname(targetDir), { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true });
  return { ok: true };
}

function main() {
  const targetDir = process.env.SITE_DIR ?? 'site';
  const result = initSite();
  if (!result.ok) {
    console.error(`✗ ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ copied examples/solluna to ${targetDir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
