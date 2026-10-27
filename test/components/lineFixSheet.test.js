// @ts-check
/**
 * Task 13: the line-by-line fix sheet. Marking a line plain must hand the
 * page exactly `{part, line, as: 'plain'}`; picking a speaker likewise
 * hands it a speech fix with that speaker -- the page owns storage and
 * re-preview, the sheet only reports what was chosen.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MiniElement } from '../helpers/miniDom.js';
import { mount } from '../../public/js/core/dom.js';
// Dynamic import: see header.test.js for why.
const { render, bind } = await import('../../public/js/components/lineFixSheet.js');

const OPTIONS = {
  people: [{ id: 1, displayName: 'emi', emoji: '🧡', igHandle: 'emiamily' }],
  roles: ['host', 'fan', 'speaker', 'crowd'],
  events: [],
  categories: [],
  clients: [],
};

const LINE = { kind: 'speech', marker: '🐶', markers: ['🐶'], text: 'hello there', part: 1, line: 3 };

/** Mounts the sheet and binds it, collecting everything it emits. */
function mounted(line = LINE) {
  const root = new MiniElement('div');
  mount(root, render({ line, options: OPTIONS }));
  /** @type {any[]} */
  const emitted = [];
  bind(root, { line, onFix: (fix) => emitted.push(fix) });
  return { root, emitted };
}

test('lineFixSheet: shows the line, speech and plain choices', () => {
  const markup = String(render({ line: LINE, options: OPTIONS }));
  assert.match(markup, /hello there/);
  assert.match(markup, /data-action="speech"/);
  assert.match(markup, /data-action="plain"/);
});

test('lineFixSheet: choosing plain emits {part, line, as: "plain"}', () => {
  const { root, emitted } = mounted();
  /** @type {any} */ (root.querySelector('[data-action="plain"]')).click();
  assert.deepEqual(emitted, [{ part: 1, line: 3, as: 'plain' }]);
});

test('lineFixSheet: choosing a known person emits a speech fix with that speaker', () => {
  const { root, emitted } = mounted();
  /** @type {any} */ (root.querySelector('[data-action="speech"]')).click();
  /** @type {any} */ (root.querySelector('[data-pick-person="1"]')).click();
  assert.deepEqual(emitted, [{ part: 1, line: 3, as: 'speech', speaker: { person: 1 } }]);
});

test('lineFixSheet: choosing a generic role emits a speech fix with that role', () => {
  const { root, emitted } = mounted();
  /** @type {any} */ (root.querySelector('[data-action="speech"]')).click();
  /** @type {any} */ (root.querySelector('[data-pick-role="host"]')).click();
  assert.deepEqual(emitted, [{ part: 1, line: 3, as: 'speech', speaker: { role: 'host' } }]);
});
