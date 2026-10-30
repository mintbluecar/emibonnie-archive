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
    accountHandle: 'tl_alpha', accountUrl: 'https://x.com/tl_alpha', hasVideo: true, followsOnFrom: null, thumb: null,
    occurredOn: '2026-10-14', placement: 'post',
    ...overrides,
  };
}

test('previewCard: renders the opening lines via bubbles, and a meta row with a video marker (no translator icon any more)', () => {
  const markup = String(render({ result: baseResult() }));
  assert.match(markup, /href="\/t\/1"/);
  assert.match(markup, /c-bubbles__bub/, 'embeds the bubbles component output');
  assert.ok(!markup.includes('c-icon--translator'), 'the translate icon is gone (owner, 2026-10-23)');
  assert.match(markup, /aria-label="video"/);
});

test('previewCard (owner, 2026-10-23): the translator credit line links to their X profile, with target/rel', () => {
  const markup = String(render({ result: baseResult() }));
  assert.match(markup, /<p class="c-card-credit">translated by: <a class="c-card-credit__link" href="https:\/\/x\.com\/tl_alpha" target="_blank" rel="noopener noreferrer">@tl_alpha<\/a><\/p>/);
});

test('previewCard (owner, 2026-10-23): an account with no profile link shows plain "@handle" text, not a link', () => {
  const markup = String(render({ result: baseResult({ accountUrl: null }) }));
  assert.match(markup, /<p class="c-card-credit">translated by: @tl_alpha<\/p>/);
});

test('previewCard: no accountHandle means no credit line at all, no video, means no meta for it; follows-on shows as plain text, not a link', () => {
  const markup = String(render({ result: baseResult({ accountHandle: null, accountUrl: null, hasVideo: false, followsOnFrom: { sourceId: '0', url: '/t/0' } }) }));
  assert.ok(!markup.includes('c-card-credit'));
  assert.ok(!markup.includes('aria-label="video"'));
  assert.ok(!markup.includes('/t/0'), 'followsOnFrom.url is never rendered -- it is plain text, not a link');
  assert.match(markup, /follows on from ↑/);
});

test('previewCard: the card root is not an <a> containing another <a> -- the main link is the only one inside, the credit link is a sibling', () => {
  const markup = String(render({ result: baseResult({ followsOnFrom: { sourceId: '0', url: '/t/0' } }) }));
  assert.ok(!/^<a[\s>]/.test(markup.trim()), 'the card root is not an <a>');
  assert.match(markup, /<a class="c-preview-card__link" href="\/t\/1">/, 'the main link is still present');
  const anchors = markup.match(/<a[\s>]/g) ?? [];
  assert.equal(anchors.length, 2, 'the main link and the credit link, never nested');
  const mainLinkClose = markup.indexOf('</a>');
  const creditLinkOpen = markup.indexOf('c-card-credit__link');
  assert.ok(mainLinkClose > -1 && creditLinkOpen > mainLinkClose, 'the main link closes before the credit link opens -- siblings, not nested');
});

test('bind: delegates to bubbles.bind, colouring the embedded avatar', () => {
  const coloured = new FakeEl({ 'data-c': '#b5651d' });
  const mountPoint = new FakeEl({}, [coloured]);
  bind(mountPoint);
  assert.equal(coloured.styleProps['--c'], '#b5651d');
});

test('previewCard (Task 9b): compact shows the opening lines as one clamped run of "emoji text", not full bubbles, and keeps the meta row, the credit line, and the main link', () => {
  const markup = String(render({ result: baseResult(), compact: true }));
  assert.match(markup, /class="c-preview-card c-preview-card--compact"/);
  assert.match(markup, /c-bubbles-compact/);
  assert.ok(!markup.includes('c-bubbles__bub'));
  assert.match(markup, /c-card-credit__link" href="https:\/\/x\.com\/tl_alpha"/);
  assert.equal((markup.match(/<a[\s>]/g) ?? []).length, 2);
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
  assert.equal((clip.match(/<a[\s>]/g) ?? []).length, 2, 'the main link and the credit link');
});

test('previewCard (Task 11): eager passes through to the thumbnail; lazy otherwise', () => {
  const thumb = { url: 'https://pbs.twimg.com/media/a?format=jpg&name=small', width: 4, height: 3, video: false };
  assert.match(String(render({ result: baseResult({ thumb }), eager: true })), /loading="eager" fetchpriority="high"/);
  assert.match(String(render({ result: baseResult({ thumb }) })), /loading="lazy"/);
});
