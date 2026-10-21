// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildKindsRegistryModule, listKindFolders } from '../../scripts/buildOutputs.js';

const KINDS_DIR = fileURLToPath(new URL('../../src/kinds/', import.meta.url));

test('the generated registry maps each kind folder to its Kind object', async () => {
  // Regenerate it, as `npm run build` would, so the test never reads a stale file.
  writeFileSync(path.join(KINDS_DIR, '_registry.js'), buildKindsRegistryModule(listKindFolders(KINDS_DIR)));
  const { kindsRegistry } = await import('../../src/kinds/_registry.js');
  assert.ok(Object.keys(kindsRegistry).includes('translation'));
  for (const [folder, kind] of Object.entries(kindsRegistry)) {
    assert.equal(kind.name, folder);
    assert.equal(typeof kind.draft, 'function');
  }
});
