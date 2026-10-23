// @ts-check
/**
 * `public/js/kinds/_registry.js` is generated once, before any test file
 * runs, by `npm test`'s `pretest` step (`scripts/genRegistries.js`) --
 * not by this file. See scripts/buildOutputs.js's `writeKindsRegistries`
 * doc comment (Plan 1b Task 7 brief, carried item B) for why, and
 * test/kinds/registry.test.js for the server-side registry's own case.
 * It's generated with the translation kind's real urlPrefix (`/t/`, from
 * src/kinds/translation/index.js), same as `npm run build`.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Dynamic import, after '../helpers/siteFixture.js' has installed its loader hook for
// '/site/site.js' (see test/components/header.test.js for why): a static import here would be
// resolved -- and fail -- before that hook exists, since static imports in a file all resolve
// together, ahead of any module's top-level code running.
const { KIND_UI, renderSections } = await import('../../public/js/kinds/_registry.js');

test('the generated front-end registry maps each kind folder to its {section, detail} UI', () => {
  assert.ok(Object.keys(KIND_UI).includes('translation'));
  assert.equal(typeof KIND_UI.translation.section.render, 'function');
  assert.equal(typeof KIND_UI.translation.detail.render, 'function');
});

test('the generated front-end registry also carries each kind\'s urlPrefix, so the item page can map a URL to its kind without naming one', () => {
  assert.equal(KIND_UI.translation.urlPrefix, '/t/');
});

test('renderSections: renders a section for a known kind, and skips one for an unknown kind', () => {
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
