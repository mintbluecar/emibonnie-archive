// @ts-check
/**
 * Styling system Task 3 (spec "7. Docs and the style guide"): builds the
 * dev-only style guide page (`/dev/styleguide`, `scripts/dev.js`) from its
 * tracked template (`dev/styleguide/index.html.tmpl`) and the real build's
 * `manifest.json`, resolving `{{asset:...}}` placeholders the same way
 * every other page's are (`scripts/buildBundle.js`'s `resolveAssetPlaceholders`,
 * reused rather than re-implemented here). `dev/` sits outside `public/`,
 * so the generated `dev/styleguide/index.html` never reaches production
 * -- it's gitignored, and this is called from `npm run build` purely for
 * local convenience.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAssetPlaceholders } from './buildBundle.js';

/** The template's fixed location, next to this script -- never the caller's `repoRoot` (same pattern as `buildAssets.js`'s self-hosted fonts): the style guide is engine tooling, not a site asset. */
const TEMPLATE_PATH = fileURLToPath(new URL('../dev/styleguide/index.html.tmpl', import.meta.url));

/**
 * @param {{ manifestPath: string, outPath: string }} options
 * @returns {void}
 */
export function buildStyleguide({ manifestPath, outPath }) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const template = readFileSync(TEMPLATE_PATH, 'utf8');
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, resolveAssetPlaceholders(template, manifest));
}

async function main() {
  buildStyleguide({ manifestPath: 'public/build/manifest.json', outPath: 'dev/styleguide/index.html' });
  console.log('styleguide: ok');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
