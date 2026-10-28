// @ts-check
/**
 * Task 13: step 3 of the add flow. The brief's central rule: an unmapped
 * marker never disables Save -- the note says how many are left, and the
 * entry still saves with those lines showing the marker itself.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyRe } from '../helpers/copyMarkup.js';
// Dynamic import: see header.test.js for why.
const { render } = await import('../../public/js/components/speakerStep.js');
const { t, tCount } = await import('../../public/js/core/site.js');

const OPTIONS = {
  people: [{ id: 1, displayName: 'emi', emoji: '🧡', igHandle: 'emiamily' }],
  roles: ['host', 'fan', 'speaker', 'crowd'],
  events: [],
  categories: [],
  clients: [],
};

/** @returns {any} a preview draft with two markers, one mapped */
function draft(overrides = {}) {
  return {
    markers: [{ marker: '🐶', count: 2 }, { marker: '🐱', count: 1 }],
    speakers: { '🐶': { person: 1 } },
    memory: { '🐶': { person: 1 } },
    unmapped: [{ marker: '🐱', count: 1 }],
    lines: [
      { kind: 'speech', marker: '🐶', markers: ['🐶'], text: 'hello there', part: 0, line: 0 },
      { kind: 'speech', marker: '🐱', markers: ['🐱'], text: 'hi back', part: 0, line: 1 },
      { kind: 'plain', text: 'a plain line', part: 0, line: 2 },
    ],
    subbed: false,
    ...overrides,
  };
}

/**
 * @param {{ draft?: any, chosen?: any, open?: string|null, lineFixes?: any[] }} [props]
 */
function markupOf({ draft: d = draft(), chosen = {}, open = null, lineFixes = [] } = {}) {
  return String(render({ draft: d, options: OPTIONS, isOwner: false, chosen, open, lineFixes }));
}

test('speakerStep: one unmapped marker shows the note and leaves Save enabled', () => {
  const markup = markupOf();
  assert.match(markup, copyRe(tCount('add.unmappedNote', 1)));
  assert.match(markup, /data-action="save"/);
  const saveTag = markup.match(/<button[^>]*data-action="save"[^>]*>/)?.[0] ?? '';
  assert.ok(saveTag, 'a save button');
  assert.ok(!/\bdisabled\b/.test(saveTag), `save is never disabled for unmapped markers: ${saveTag}`);
});

test('speakerStep: a subbed entry skips the step entirely', () => {
  assert.equal(String(render({ draft: draft({ subbed: true }), options: OPTIONS, isOwner: false, chosen: {}, open: null, lineFixes: [] })).trim(), '');
});

test('speakerStep: every marker gets a picker, the known person first and the generic roles after', () => {
  const markup = markupOf({ open: '🐱' });
  assert.match(markup, /🐶/);
  assert.match(markup, /🐱/);
  assert.match(markup, /🧡/);
  assert.match(markup, /emi/);
  for (const role of OPTIONS.roles) assert.match(markup, copyRe(t(`add.role.${role}`)), role);
  assert.match(markup, copyRe(t('add.newPerson')));
  assert.match(markup, copyRe(t('add.searchPeople')));
});

test('speakerStep: a remembered answer is labelled, a fresh choice is not', () => {
  assert.match(markupOf(), copyRe(t('add.remembered')));
  const chosen = { '🐶': { person: 1 } };
  assert.ok(!markupOf({ chosen }).includes(t('add.remembered')));
});

test('speakerStep: every line is shown as it will read, and is tappable', () => {
  const markup = markupOf();
  assert.match(markup, /hello there/);
  assert.match(markup, /hi back/);
  assert.match(markup, /a plain line/);
  assert.match(markup, /data-part="0"[^>]*data-line="0"/);
  assert.match(markup, /data-part="0"[^>]*data-line="1"/);
  assert.match(markup, /data-part="0"[^>]*data-line="2"/);
});
