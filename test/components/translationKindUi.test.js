// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeEl } from '../helpers/fakeDom.js';
// Dynamic import: see test/components/header.test.js for why.
const section = await import('../../public/js/kinds/translation/section.js');
const detail = await import('../../public/js/kinds/translation/detail.js');

/** @returns {import('../../src/http/contracts.js').Preview} */
function preview() {
  return {
    kind: 'translation', sourceId: '1', url: '/t/1',
    lines: [{ kind: 'speech', emoji: '🦁', name: 'host', colour: '#b5651d', text: 'hi', cont: false }],
    people: [], accountHandle: 'tl_alpha', hasVideo: false, followsOnFrom: null,
    occurredOn: '2026-10-14', placement: 'post',
  };
}

test('translation section: renders each item as a preview card', () => {
  /** @type {import('../../src/http/contracts.js').Section} */
  const sectionVm = { kind: 'translation', total: 1, hasMore: false, items: [preview()] };
  const markup = String(section.render(sectionVm));
  assert.match(markup, /data-kind="translation"/);
  assert.match(markup, /href="\/t\/1"/);
});

/** @param {Partial<import('../../src/http/contracts.js').DetailVM>} [overrides] @returns {import('../../src/http/contracts.js').DetailVM} */
function detailVm(overrides = {}) {
  return {
    bubbles: [{ kind: 'speech', emoji: '🧡', name: 'sol', colour: '#ff8a3d', text: 'hello', cont: false }],
    cast: [{ kind: 'person', id: 1, emoji: '🧡', name: 'sol', colour: '#ff8a3d', igHandle: null }],
    original: 'first paragraph\n\nsecond paragraph',
    credits: { account: { handle: 'tl_alpha', displayName: null }, clipBy: null, postedAt: null, occurredOn: '2026-10-14' },
    sources: [],
    media: null,
    ...overrides,
  };
}

test('translation detail: renders credits, cast, bubbles, and a hidden original toggle', () => {
  const markup = String(detail.render(detailVm()));
  assert.match(markup, /tl <b>@tl_alpha<\/b>/);
  assert.match(markup, /c-cast__chip/);
  assert.match(markup, /c-bubbles__bub/);
  assert.match(markup, /show original/);
  assert.match(markup, /hidden/);
  assert.match(markup, /first paragraph/);
});

test('translation detail: Thai-script text in the original gets lang="th", same as bubbles.js', () => {
  const markup = String(detail.render(detailVm({ original: 'hello ครบ world' })));
  assert.match(markup, /<span lang="th">ครบ<\/span>/);
});

test('translation detail: Thai-script text in a quote gets lang="th" too', () => {
  /** @type {import('../../src/http/contracts.js').MediaVM} */
  const media = { type: 'quote', authorName: 'x', authorHandle: null, text: 'hello ครบ world', postedAt: null, inner: null };
  const markup = String(detail.render(detailVm({ media })));
  assert.match(markup, /<span lang="th">ครบ<\/span>/);
});

test('translation detail bind: toggling the original flips aria-expanded and hidden', () => {
  const toggle = new FakeEl({ 'data-role': 'toggle' });
  const original = new FakeEl({ 'data-role': 'original' });
  toggle.getAttribute = (name) => (name === 'aria-expanded' ? 'false' : null);
  /** @type {Record<string,string>} */
  const setAttrs = {};
  toggle.setAttribute = (name, value) => { setAttrs[name] = value; };
  original.hidden = true;
  const listeners = [];
  const root = new FakeEl({}, [toggle, original]);
  root.querySelector = (selector) => (selector.includes('original') ? original : null);
  root.addEventListener = (event, fn) => listeners.push([event, fn]);
  root.contains = () => true;
  toggle.closest = () => toggle;
  detail.bind(root);
  const clickHandler = listeners.find(([event]) => event === 'click')[1];
  clickHandler({ target: toggle });
  assert.equal(setAttrs['aria-expanded'], 'true');
  assert.equal(original.hidden, false);
});
