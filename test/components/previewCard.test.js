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
    accountHandle: 'tl_alpha', hasVideo: true, followsOnFrom: null, thumb: null,
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

test('previewCard: no accountHandle, no video, means no meta for them; follows-on shows as plain text, not a link', () => {
  const markup = String(render({ result: baseResult({ accountHandle: null, hasVideo: false, followsOnFrom: { sourceId: '0', url: '/t/0' } }) }));
  assert.ok(!markup.includes('tl @'));
  assert.ok(!markup.includes('aria-label="video"'));
  assert.ok(!markup.includes('/t/0'), 'followsOnFrom.url is never rendered -- it is plain text, not a link');
  assert.match(markup, /follows on from ↑/);
});

test('previewCard: the card never nests a second <a> -- its own outer anchor is the only link, even with a video and a follows-on', () => {
  const markup = String(render({ result: baseResult({ followsOnFrom: { sourceId: '0', url: '/t/0' } }) }));
  const anchors = markup.match(/<a[\s>]/g) ?? [];
  assert.equal(anchors.length, 1);
});

test('bind: delegates to bubbles.bind, colouring the embedded avatar', () => {
  const coloured = new FakeEl({ 'data-c': '#b5651d' });
  const mountPoint = new FakeEl({}, [coloured]);
  bind(mountPoint);
  assert.equal(coloured.styleProps['--c'], '#b5651d');
});

test('previewCard (Task 9b): compact shows the opening lines as one clamped run of "emoji text", not full bubbles, and keeps the meta row and the one link', () => {
  const markup = String(render({ result: baseResult(), compact: true }));
  assert.match(markup, /class="c-preview-card c-preview-card--compact"/);
  assert.match(markup, /c-bubbles-compact/);
  assert.ok(!markup.includes('c-bubbles__bub'));
  assert.match(markup, /tl @tl_alpha/);
  assert.equal((markup.match(/<a[\s>]/g) ?? []).length, 1);
  assert.ok(!String(render({ result: baseResult() })).includes('c-preview-card--compact'), 'full bubbles by default');
});

test('previewCard (Task 10c): a clip poster thumbnail with a ▶ replaces the 🎬; a photo has no ▶; lazy, async, sized, alt from copy; text only has none', () => {
  const poster = { url: 'https://pbs.twimg.com/amplify_video_thumb/1/img/a.jpg', width: 1080, height: 1920, video: true };
  const clip = String(render({ result: baseResult({ thumb: poster }), compact: true }));
  assert.match(clip, /class="c-preview-card c-preview-card--compact c-preview-card--thumb"/);
  assert.match(clip, /<img class="c-thumb__img" src="https:\/\/pbs\.twimg\.com\/amplify_video_thumb\/1\/img\/a\.jpg" alt="clip still" width="1080" height="1920" loading="lazy" decoding="async">/);
  assert.match(clip, /c-thumb__play" aria-hidden="true">▶/);
  assert.ok(!clip.includes('🎬'), 'the ▶ thumbnail stands in for the video marker');
  const photo = String(render({ result: baseResult({ hasVideo: false, thumb: { ...poster, video: false } }) }));
  assert.match(photo, /alt="photo"/);
  assert.ok(!photo.includes('c-thumb__play'));
  assert.ok(String(render({ result: baseResult({ thumb: null }) })).includes('🎬'), 'a clip with no poster keeps 🎬');
  assert.ok(!String(render({ result: baseResult({ hasVideo: false }) })).includes('c-thumb'));
  assert.equal((clip.match(/<a[\s>]/g) ?? []).length, 1);
});
