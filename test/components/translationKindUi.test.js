// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeEl } from '../helpers/fakeDom.js';
import { html } from '../../public/js/core/html.js';
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

test('translation detail: renders credits, cast, bubbles, and a native <details> "show original"', () => {
  const markup = String(detail.render(detailVm()));
  assert.match(markup, /tl <b>@tl_alpha<\/b>/);
  assert.match(markup, /c-cast__chip/);
  assert.match(markup, /c-bubbles__bub/);
  assert.match(markup, /<details class="k-translation-detail__original">/);
  assert.match(markup, /<summary class="k-translation-detail__original-toggle">show original<\/summary>/);
  assert.match(markup, /first paragraph/);
});

test('translation detail: Thai-script text in the original gets lang="th", same as bubbles.js', () => {
  const markup = String(detail.render(detailVm({ original: 'hello ครบ world' })));
  assert.match(markup, /<span lang="th">ครบ<\/span>/);
});

test('translation detail (Task 10b): credits show the event date (dayLabel) and no time -- not the post time, never the viewer\'s local time', () => {
  const credits = { account: { handle: 'tl_alpha', displayName: null }, clipBy: null, postedAt: '2026-10-19T08:00:00.000Z', occurredOn: '2026-10-19' };
  const markup = String(detail.render(detailVm({ credits })));
  assert.match(markup, /19 Oct 2026/);
  assert.ok(!/\d:\d\d|\b(am|pm)\b|bangkok/.test(markup), markup);
});

test('translation detail: renders no media -- that is the item page\'s own mediaBox component\'s job', () => {
  /** @type {import('../../src/http/contracts.js').MediaVM} */
  const media = { type: 'quote', authorName: 'x', authorHandle: null, text: 'hello ครบ world', postedAt: null, inner: null };
  const markup = String(detail.render(detailVm({ media })));
  assert.ok(!markup.includes('c-quote'));
  assert.ok(!markup.includes('ครบ'));
});

test('translation detail: an optional afterCredits slot renders between credits and the cast legend', () => {
  const markup = String(detail.render(detailVm(), { afterCredits: html`<div class="c-chips">PILL</div>` }));
  const creditsIndex = markup.indexOf('k-translation-detail__credits');
  const pillIndex = markup.indexOf('PILL');
  const castIndex = markup.indexOf('c-cast__chip');
  assert.ok(creditsIndex < pillIndex && pillIndex < castIndex, 'afterCredits renders between credits and cast');
});

test('translation detail bind: wires cast/bubbles colours and adds no listener of its own (the <details> toggle is native)', () => {
  const root = new FakeEl({}, []);
  /** @type {[string, Function][]} */
  const listeners = [];
  root.addEventListener = (/** @type {string} */ event, /** @type {Function} */ fn) => listeners.push([event, fn]);
  root.contains = () => true;
  assert.doesNotThrow(() => detail.bind(root));
  assert.deepEqual(listeners, []);
});

test('translation section (Task 9b): ctx.compact renders compact preview cards (the person and translator pages ask for it)', () => {
  const sectionVm = { kind: 'translation', total: 1, hasMore: false, items: [preview()] };
  assert.match(String(section.render(sectionVm, { compact: true })), /c-preview-card--compact/);
  assert.ok(!String(section.render(sectionVm, {})).includes('c-preview-card--compact'));
});
