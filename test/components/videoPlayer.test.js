// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { MiniElement, fakeDocument } from '../helpers/miniDom.js';
import { mount } from '../../public/js/core/dom.js';
// Dynamic import: see test/components/header.test.js for why (videoPlayer
// renders item.sourceGone via t(), which transitively imports '/site/site.js').
const { pickVariant, render, bind } = await import('../../public/js/components/videoPlayer.js');

/** @type {import('../../src/http/contracts.js').VariantVM[]} */
const VARIANTS = [
  { bitrate: 632000, url: 'https://video.twimg.com/a/632000.mp4' },
  { bitrate: 950000, url: 'https://video.twimg.com/a/950000.mp4' },
  { bitrate: 2176000, url: 'https://video.twimg.com/a/2176000.mp4' },
  { bitrate: 10368000, url: 'https://video.twimg.com/a/10368000.mp4' },
];

test('pickVariant: a small screen gets the smallest variant (632k)', () => {
  assert.equal(pickVariant(VARIANTS, true).bitrate, 632000);
});

test('pickVariant: a large screen gets the largest variant at or below 2,200,000 bps (2176k)', () => {
  assert.equal(pickVariant(VARIANTS, false).bitrate, 2176000);
});

test('pickVariant: a large screen with no variant at or below the cap gets the smallest', () => {
  const allHigh = [{ bitrate: 3000000, url: 'https://video.twimg.com/a/3000000.mp4' }, { bitrate: 5000000, url: 'https://video.twimg.com/a/5000000.mp4' }];
  assert.equal(pickVariant(allHigh, false).bitrate, 3000000);
});

test('render: a 720x1280 vertical clip renders a full-screen button and data-aspect="0.5625"', () => {
  const markup = String(render({ variants: VARIANTS, width: 720, height: 1280 }));
  assert.match(markup, /class="c-video"/);
  assert.match(markup, /data-aspect="0\.5625"/);
  assert.match(markup, /class="c-video__full"/);
  assert.match(markup, /<video[^>]*controls[^>]*playsinline[^>]*preload="metadata"/);
});

test('render: the video has a src attribute pointing at the stored variant, never a <source> child (review round 1, CRITICAL #1 -- a <source>\'s error never bubbles to <video>)', () => {
  const markup = String(render({ variants: VARIANTS, width: 1280, height: 720 }));
  assert.match(markup, /<video[^>]*\bsrc="https:\/\/video\.twimg\.com\/a\/2176000\.mp4"[^>]*><\/video>/);
  assert.ok(!markup.includes('<source'), 'no <source> child');
});

/** One macrotask tick, enough for a single `await getJson(...)` chain to settle. */
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

test('bind: an error event triggers one refetch of /api/video/:kind/:sourceId; a 404 swaps in the sourceGone copy', async () => {
  const root = new MiniElement('div');
  mount(root, render({ variants: VARIANTS, width: 1280, height: 720 }));
  globalThis.document = fakeDocument();
  /** @type {string[]} */
  const seenUrls = [];
  mock.method(globalThis, 'fetch', async (/** @type {string} */ url) => {
    seenUrls.push(String(url));
    return new Response('not found', { status: 404 });
  });
  try {
    bind(root, { kind: 'translation', sourceId: '1900000000000000002' });
    const video = /** @type {any} */ (root.querySelector('video'));
    assert.ok(video);
    video.dispatchEvent({ type: 'error', target: video });
    await flush();
    assert.ok(seenUrls.some((u) => u.includes('/api/video/translation/1900000000000000002')), seenUrls.join(', '));
    assert.equal(root.querySelector('video'), null, 'the video element is replaced');
    assert.ok(root.querySelector('.c-video__gone'), 'the sourceGone note is shown');
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
  }
});

test('bind: applies the rendered data-aspect to --aspect via style.setProperty (CSP: no inline style attribute)', () => {
  const root = new MiniElement('div');
  mount(root, render({ variants: VARIANTS, width: 720, height: 1280 }));
  globalThis.document = fakeDocument();
  try {
    bind(root, { kind: 'translation', sourceId: '1900000000000000002' });
    const box = /** @type {any} */ (root.querySelector('.c-video'));
    assert.equal(box.styleProps['--aspect'], '0.5625');
  } finally {
    delete (/** @type {any} */ (globalThis)).document;
  }
});

test('bind: on a phone-width viewport, swaps the initial source to the small variant (render() alone always picks the large one)', () => {
  const root = new MiniElement('div');
  mount(root, render({ variants: VARIANTS, width: 1280, height: 720 }));
  globalThis.document = fakeDocument();
  globalThis.window = /** @type {any} */ ({ matchMedia: () => ({ matches: true }) });
  try {
    bind(root, { kind: 'translation', sourceId: '1900000000000000002', variants: VARIANTS });
    const video = root.querySelector('video');
    assert.equal(video?.getAttribute('src'), 'https://video.twimg.com/a/632000.mp4');
  } finally {
    delete (/** @type {any} */ (globalThis)).document;
    delete (/** @type {any} */ (globalThis)).window;
  }
});

test('bind: on a wide viewport, keeps render()\'s large-variant default', () => {
  const root = new MiniElement('div');
  mount(root, render({ variants: VARIANTS, width: 1280, height: 720 }));
  globalThis.document = fakeDocument();
  globalThis.window = /** @type {any} */ ({ matchMedia: () => ({ matches: false }) });
  try {
    bind(root, { kind: 'translation', sourceId: '1900000000000000002', variants: VARIANTS });
    const video = root.querySelector('video');
    assert.equal(video?.getAttribute('src'), 'https://video.twimg.com/a/2176000.mp4');
  } finally {
    delete (/** @type {any} */ (globalThis)).document;
    delete (/** @type {any} */ (globalThis)).window;
  }
});

test('bind: a second error, after the refetch already ran, never fetches again -- the first 404 case', async () => {
  const root = new MiniElement('div');
  mount(root, render({ variants: VARIANTS, width: 1280, height: 720 }));
  globalThis.document = fakeDocument();
  let fetchCount = 0;
  mock.method(globalThis, 'fetch', async () => { fetchCount += 1; return new Response('not found', { status: 404 }); });
  try {
    bind(root, { kind: 'translation', sourceId: '1900000000000000002' });
    const video = /** @type {any} */ (root.querySelector('video'));
    video.dispatchEvent({ type: 'error', target: video });
    await flush();
    assert.equal(fetchCount, 1);
    assert.equal(root.querySelector('video'), null);
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
  }
});

test('bind: a second error, after the refetch succeeded but the swapped-in variant also fails to play, mounts sourceGone and never fetches again (review round 1, IMPORTANT #4)', async () => {
  const root = new MiniElement('div');
  mount(root, render({ variants: VARIANTS, width: 1280, height: 720 }));
  globalThis.document = fakeDocument();
  let fetchCount = 0;
  mock.method(globalThis, 'fetch', async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({ variants: VARIANTS }), { status: 200 });
  });
  try {
    bind(root, { kind: 'translation', sourceId: '1900000000000000002' });
    const video = /** @type {any} */ (root.querySelector('video'));
    video.dispatchEvent({ type: 'error', target: video });
    await flush();
    assert.equal(fetchCount, 1, 'the one refetch ran and succeeded');
    assert.ok(root.querySelector('video'), 'the video is still there after a successful refetch');
    assert.ok(!root.querySelector('.c-video__gone'), 'not given up yet after just one error');

    // The swapped-in variant also fails to play (still a fake/synthetic URL in practice).
    const stillVideo = /** @type {any} */ (root.querySelector('video'));
    stillVideo.dispatchEvent({ type: 'error', target: stillVideo });
    await flush();
    assert.equal(fetchCount, 1, 'no second fetch');
    assert.equal(root.querySelector('video'), null, 'gives up: the video is replaced');
    assert.ok(root.querySelector('.c-video__gone'), 'the sourceGone note is shown');
  } finally {
    mock.restoreAll();
    delete (/** @type {any} */ (globalThis)).document;
  }
});
