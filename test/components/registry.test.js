// @ts-check
/**
 * `public/js/kinds/_registry.js` is generated the same way
 * `src/kinds/_registry.js` is (see test/kinds/registry.test.js): this
 * regenerates it from the real `public/js/kinds/` folders before
 * importing, so the test never reads a stale file.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildFrontendKindsRegistryModule, listKindFolders } from '../../scripts/buildOutputs.js';

const KINDS_DIR = fileURLToPath(new URL('../../public/js/kinds/', import.meta.url));

test('the generated front-end registry maps each kind folder to its {section, detail} UI', async () => {
  writeFileSync(path.join(KINDS_DIR, '_registry.js'), buildFrontendKindsRegistryModule(listKindFolders(KINDS_DIR)));
  const { KIND_UI } = await import('../../public/js/kinds/_registry.js');
  assert.ok(Object.keys(KIND_UI).includes('translation'));
  assert.equal(typeof KIND_UI.translation.section.render, 'function');
  assert.equal(typeof KIND_UI.translation.detail.render, 'function');
});

test('the generated front-end registry also carries each kind\'s urlPrefix, so the item page can map a URL to its kind without naming one', async () => {
  writeFileSync(path.join(KINDS_DIR, '_registry.js'), buildFrontendKindsRegistryModule(listKindFolders(KINDS_DIR), { translation: '/t/' }));
  // A cache-busting query string: Node's ESM loader caches by resolved
  // URL, and an earlier test in this file already imported this same
  // path with different (urlPrefix-less) generated content.
  const { KIND_UI } = await import(`../../public/js/kinds/_registry.js?${Date.now()}`);
  assert.equal(KIND_UI.translation.urlPrefix, '/t/');
});

test('renderSections: renders a section for a known kind, and skips one for an unknown kind', async () => {
  writeFileSync(path.join(KINDS_DIR, '_registry.js'), buildFrontendKindsRegistryModule(listKindFolders(KINDS_DIR)));
  const { renderSections } = await import('../../public/js/kinds/_registry.js');

  /** @type {import('../../src/http/contracts.js').Preview} */
  const item = {
    kind: 'translation', sourceId: '1', url: '/t/1', lines: [], people: [], accountHandle: null,
    hasVideo: false, followsOnFrom: null, occurredOn: '2026-10-14', placement: 'post',
  };
  /** @type {import('../../src/http/contracts.js').Section[]} */
  const sections = [
    { kind: 'translation', total: 1, hasMore: false, items: [item] },
    { kind: 'some_future_kind', total: 1, hasMore: false, items: [item] },
  ];
  const rendered = renderSections(sections, {});
  assert.equal(rendered.length, 1, 'the unknown kind is skipped, not thrown on');
  assert.match(String(rendered[0]), /data-kind="translation"/);
});
