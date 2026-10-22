// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MiniElement, fakeDocument } from '../helpers/miniDom.js';
import { mount } from '../../public/js/core/dom.js';
import { EMPTY_STATE } from '../../public/js/state/searchState.js';
// Dynamic import: see test/components/header.test.js for why.
const { render, bind } = await import('../../public/js/components/filterSheet.js');

/** @type {import('../../src/http/contracts.js').FilterOptions} */
const OPTIONS = {
  people: [
    { id: 1, name: 'sol', emoji: '☀️', colour: '#c47a12', igHandle: 'solsunny' },
    { id: 2, name: 'luna', emoji: '🌙', colour: '#6a5cd6', igHandle: 'lunamoon' },
  ],
  categories: [{ id: 5, name: 'live' }, { id: 6, name: 'show / interview' }],
  events: [{ slug: 'solluna-happy-day-2026-10-19', name: 'SOLLUNA HAPPY DAY' }],
  accounts: [{ handle: 'tl_beta' }, { handle: 'tl_gamma' }],
};

test('render: shows the count copy on the apply button', () => {
  const markup = String(render({ state: EMPTY_STATE, options: OPTIONS, count: 7 }));
  assert.match(markup, /c-filter-sheet__apply[^>]*>show 7</);
});

/** The whole `<button ...>label</button>` tag for one chip's `data-value`, wherever its attributes land. @param {string} markup @param {string} value @returns {string} */
function chipTag(markup, value) {
  const match = new RegExp(`<button[^>]*data-value="${value}"[^>]*>[^<]*</button>`).exec(markup);
  assert.ok(match, `no chip with data-value="${value}" in ${markup}`);
  return match[0];
}

test('render: selected people and type chips are marked .on, unselected ones are not', () => {
  const state = { ...EMPTY_STATE, people: [2], types: ['live'] };
  const markup = String(render({ state, options: OPTIONS, count: 3 }));
  assert.ok(chipTag(markup, '2').includes('c-chips__chip--on'), 'luna is selected');
  assert.ok(chipTag(markup, '2').includes('🌙 luna'));
  assert.ok(!chipTag(markup, '1').includes('c-chips__chip--on'), 'sol is not selected');
  assert.ok(chipTag(markup, 'live').includes('c-chips__chip--on'), 'live is selected');
  assert.ok(!chipTag(markup, 'shared story').includes('c-chips__chip--on'), 'shared story is not selected');
});

test('render: the any/all toggle reflects peopleMode', () => {
  const markup = String(render({ state: { ...EMPTY_STATE, peopleMode: 'all' }, options: OPTIONS, count: 0 }));
  assert.ok(chipTag(markup, 'all').includes('c-chips__chip--on'));
});

test('render: the translator select lists every account from /api/filters (ruling 7)', () => {
  const markup = String(render({ state: EMPTY_STATE, options: OPTIONS, count: 0 }));
  assert.match(markup, /<option value="tl_beta">@tl_beta<\/option>/);
  assert.match(markup, /<option value="tl_gamma">@tl_gamma<\/option>/);
});

/** Mounts the sheet, binds it, and returns its dialog + the elements the tests poke at. */
function mounted(state = EMPTY_STATE) {
  const root = new MiniElement('div');
  mount(root, render({ state, options: OPTIONS, count: 0 }));
  globalThis.document = fakeDocument();
  const dialog = /** @type {any} */ (root.querySelector('.c-filter-sheet'));
  let closed = false;
  dialog.close = () => { closed = true; };
  const opener = { focus: () => { opener.focused = true; }, focused: false };
  return { root, dialog, opener, isClosed: () => closed };
}

test('bind: a person chip click toggles its own .on state and aria-pressed', () => {
  const { root } = mounted();
  bind(root, { state: EMPTY_STATE, onChange: () => {}, opener: { focus: () => {} } });
  const chip = /** @type {any} */ (root.querySelector('[data-value="2"]'));
  chip.click();
  assert.ok(chip.classList.contains('c-chips__chip--on'));
  assert.equal(chip.getAttribute('aria-pressed'), 'true');
  chip.click();
  assert.ok(!chip.classList.contains('c-chips__chip--on'));
  assert.equal(chip.getAttribute('aria-pressed'), 'false');
});

test('bind: the apply button hands the tentative state to onChange and closes the sheet', () => {
  const { root, isClosed, opener } = mounted();
  /** @type {any} */
  let applied = null;
  bind(root, { state: EMPTY_STATE, onChange: (next) => { applied = next; }, opener });
  /** @type {any} */ (root.querySelector('[data-value="2"]')).click();
  /** @type {any} */ (root.querySelector('.c-filter-sheet__apply')).click();
  assert.deepEqual(applied?.people, [2]);
  assert.ok(isClosed(), 'the dialog was closed');
  assert.ok(opener.focused, 'focus returned to the opener');
});

test('bind: Escape closes the sheet and returns focus to the opener, without calling onChange', () => {
  const { root, isClosed, opener } = mounted();
  let onChangeCalls = 0;
  bind(root, { state: EMPTY_STATE, onChange: () => { onChangeCalls += 1; }, opener });
  root.dispatchEvent({ type: 'keydown', target: root.querySelector('.c-filter-sheet'), key: 'Escape' });
  assert.ok(isClosed(), 'the dialog was closed');
  assert.ok(opener.focused, 'focus returned to the opener');
  assert.equal(onChangeCalls, 0, 'Escape discards the tentative state, it never applies it');
});

test('bind: the close button closes the sheet and returns focus, same as Escape', () => {
  const { root, isClosed, opener } = mounted();
  bind(root, { state: EMPTY_STATE, onChange: () => {}, opener });
  /** @type {any} */ (root.querySelector('.c-filter-sheet__close')).click();
  assert.ok(isClosed());
  assert.ok(opener.focused);
});

test('bind: onTentativeChange fires live as chips are picked (so the page\'s filter badge can update before Apply), and reverts to the committed state on cancel', () => {
  const { root, opener } = mounted();
  /** @type {any[]} */
  const seen = [];
  bind(root, { state: EMPTY_STATE, onChange: () => {}, opener, onTentativeChange: (s) => seen.push(s) });
  /** @type {any} */ (root.querySelector('[data-value="2"]')).click();
  /** @type {any} */ (root.querySelector('[data-value="live"]')).click();
  assert.deepEqual(seen.at(-1)?.people, [2]);
  assert.deepEqual(seen.at(-1)?.types, ['live']);

  root.dispatchEvent({ type: 'keydown', target: root.querySelector('.c-filter-sheet'), key: 'Escape' });
  assert.deepEqual(seen.at(-1), EMPTY_STATE, 'Escape reverts the live preview back to the committed state');
});
