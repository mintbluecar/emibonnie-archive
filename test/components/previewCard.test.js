// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeEl } from '../helpers/fakeDom.js';
// Dynamic import: see test/components/header.test.js for why.
const { render, bind } = await import('../../public/js/components/previewCard.js');

/** @returns {import('../../src/http/contracts.js').Preview} */
function baseResult(overrides = {}) {
  return {
    kind: 'translation', sourceId: '1', url: '/t/1',
    lines: [{ kind: 'speech', emoji: '🦁', name: 'host', colour: '#b5651d', text: 'hi', cont: false }],
    people: [{ id: 1, name: 'sol', emoji: '🧡', colour: '#ff8a3d', igHandle: null }],
    accountHandle: 'tl_alpha', hasVideo: true, followsOnFrom: null,
    occurredOn: '2026-10-14', placement: 'post',
    ...overrides,
  };
}

test('previewCard: renders the opening lines via bubbles, and a meta row with the translator handle and a video marker', () => {
  const markup = String(render({ result: baseResult() }));
  assert.match(markup, /href="\/t\/1"/);
  assert.match(markup, /c-bubbles__bub/, 'embeds the bubbles component output');
  assert.match(markup, /tl @tl_alpha/);
  assert.match(markup, /aria-label="video"/);
});

test('previewCard: no accountHandle, no video, means no meta for them; follows-on shows a link', () => {
  const markup = String(render({ result: baseResult({ accountHandle: null, hasVideo: false, followsOnFrom: { sourceId: '0', url: '/t/0' } }) }));
  assert.ok(!markup.includes('tl @'));
  assert.ok(!markup.includes('aria-label="video"'));
  assert.match(markup, /href="\/t\/0">follows on from ↑<\/a>/);
});

test('bind: delegates to bubbles.bind, colouring the embedded avatar', () => {
  const coloured = new FakeEl({ 'data-c': '#b5651d' });
  const mountPoint = new FakeEl({}, [coloured]);
  bind(mountPoint);
  assert.equal(coloured.styleProps['--c'], '#b5651d');
});
