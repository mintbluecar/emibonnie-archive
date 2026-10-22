// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
// Dynamic import: see test/components/header.test.js for why.
const { render } = await import('../../public/js/components/mediaBox.js');

test('mediaBox: images with 2 entries renders 2 <img> elements and a 1 / 2 counter', () => {
  /** @type {import('../../src/http/contracts.js').MediaVM} */
  const media = { type: 'images', images: [{ url: 'https://pbs.twimg.com/a.jpg', width: 100, height: 100 }, { url: 'https://pbs.twimg.com/b.jpg', width: 200, height: 100 }] };
  const markup = String(render({ media }));
  assert.equal([...markup.matchAll(/<img /g)].length, 2);
  assert.match(markup, /1 \/ 2/);
});

test('mediaBox: a single image renders no counter or arrows', () => {
  /** @type {import('../../src/http/contracts.js').MediaVM} */
  const media = { type: 'images', images: [{ url: 'https://pbs.twimg.com/a.jpg', width: 100, height: 100 }] };
  const markup = String(render({ media }));
  assert.ok(!markup.includes('c-carousel__count'));
  assert.ok(!markup.includes('c-carousel__prev'));
});

test('mediaBox: quote renders the author handle and escaped text', () => {
  /** @type {import('../../src/http/contracts.js').MediaVM} */
  const media = { type: 'quote', authorName: 'fan', authorHandle: 'some_fan', text: '<script>bad()</script>', postedAt: '2026-10-19T09:00:00.000Z', inner: null };
  const markup = String(render({ media }));
  assert.match(markup, /@some_fan/);
  assert.match(markup, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.ok(!markup.includes('<script>bad()</script>'));
});

test('mediaBox: a quote with an inner clip renders the video player inside the card', () => {
  /** @type {import('../../src/http/contracts.js').MediaVM} */
  const media = {
    type: 'quote', authorName: null, authorHandle: 'clipper', text: 'hi', postedAt: null,
    inner: { type: 'video', variants: [{ bitrate: 632000, url: 'https://video.twimg.com/a.mp4' }], width: 1280, height: 720 },
  };
  const markup = String(render({ media }));
  assert.match(markup, /c-quote/);
  assert.match(markup, /c-video/);
});

test('mediaBox: null renders the sourceGone copy', () => {
  const markup = String(render({ media: null }));
  assert.match(markup, /Original tweet is no longer available/);
});
