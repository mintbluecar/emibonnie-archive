// @ts-check
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MiniElement, fakeDocument } from '../helpers/miniDom.js';
import { mount } from '../../public/js/core/dom.js';
// Dynamic import: see test/components/header.test.js for why.
const { render, bind } = await import('../../public/js/components/carousel.js');

/** @type {import('../../src/http/contracts.js').ImageVM[]} */
const IMAGES = [
  { url: 'https://pbs.twimg.com/a.jpg', width: 100, height: 200 },
  { url: 'https://pbs.twimg.com/b.jpg', width: 200, height: 100 },
  { url: 'https://pbs.twimg.com/c.jpg', width: 300, height: 300 },
];

test('render: every image has alt="", lazy loading, and async decoding', () => {
  const markup = String(render({ images: IMAGES }));
  for (const img of ['a.jpg', 'b.jpg', 'c.jpg']) {
    assert.match(markup, new RegExp(`<img class="c-carousel__img" src="https://pbs\\.twimg\\.com/${img}" alt="" loading="lazy" decoding="async">`));
  }
});

test('render: the counter announces itself (aria-live="polite")', () => {
  const markup = String(render({ images: IMAGES }));
  assert.match(markup, /<span class="c-carousel__count" aria-live="polite">1 \/ 3<\/span>/);
});

test('bind: the next/prev buttons move the shown slide and update the counter', () => {
  const root = new MiniElement('div');
  mount(root, render({ images: IMAGES }));
  globalThis.document = fakeDocument();
  try {
    bind(root, { images: IMAGES });
    const box = /** @type {any} */ (root.querySelector('.c-carousel'));
    assert.equal(box.styleProps['--aspect'], String(100 / 200), 'the first slide\'s aspect ratio, applied via style.setProperty (CSP)');
    const slides = /** @type {any[]} */ (root.querySelectorAll('.c-carousel__slide'));
    assert.equal(slides.filter((s) => !s.hidden).length, 1);
    assert.equal(root.querySelector('.c-carousel__count')?.textContent, '1 / 3');

    const next = /** @type {any} */ (root.querySelector('.c-carousel__next'));
    next.click();
    assert.equal(slides[1].hidden, false);
    assert.equal(root.querySelector('.c-carousel__count')?.textContent, '2 / 3');

    const prev = /** @type {any} */ (root.querySelector('.c-carousel__prev'));
    prev.click();
    assert.equal(slides[0].hidden, false);
    assert.equal(root.querySelector('.c-carousel__count')?.textContent, '1 / 3');
  } finally {
    delete (/** @type {any} */ (globalThis)).document;
  }
});

test('bind: prev from the first slide wraps to the last', () => {
  const root = new MiniElement('div');
  mount(root, render({ images: IMAGES }));
  globalThis.document = fakeDocument();
  try {
    bind(root, { images: IMAGES });
    /** @type {any} */ (root.querySelector('.c-carousel__prev')).click();
    assert.equal(root.querySelector('.c-carousel__count')?.textContent, '3 / 3');
  } finally {
    delete (/** @type {any} */ (globalThis)).document;
  }
});

test('bind: a swipe (pointerdown/pointerup past the threshold) moves the slide and suppresses the click that follows it, so it doesn\'t also open the zoom dialog (review round 1, IMPORTANT #3)', () => {
  const root = new MiniElement('div');
  mount(root, render({ images: IMAGES }));
  globalThis.document = fakeDocument();
  try {
    bind(root, { images: IMAGES });
    const track = /** @type {any} */ (root.querySelector('.c-carousel__track'));
    track.dispatchEvent({ type: 'pointerdown', target: track, clientX: 200 });
    track.dispatchEvent({ type: 'pointerup', target: track, clientX: 100 });
    assert.equal(root.querySelector('.c-carousel__count')?.textContent, '2 / 3', 'the swipe moved the slide');

    // The browser also fires a click on pointerup; it must not open the zoom dialog.
    const slide = /** @type {any} */ (root.querySelector('.c-carousel__slide[data-index="1"]'));
    slide.click();
    assert.equal(root.querySelector('.c-zoom'), null, 'no zoom dialog from a drag-ending click');

    // A later plain tap -- pointerdown/pointerup with a negligible delta, then click,
    // the real sequence a tap fires -- still opens it.
    track.dispatchEvent({ type: 'pointerdown', target: track, clientX: 150 });
    track.dispatchEvent({ type: 'pointerup', target: track, clientX: 151 });
    slide.click();
    assert.ok(root.querySelector('.c-zoom'), 'a real tap still opens the zoom dialog');
  } finally {
    delete (/** @type {any} */ (globalThis)).document;
  }
});

test('bind: tapping a slide opens the zoom dialog with that image', () => {
  const root = new MiniElement('div');
  mount(root, render({ images: IMAGES }));
  globalThis.document = fakeDocument();
  try {
    bind(root, { images: IMAGES });
    const slide = /** @type {any} */ (root.querySelector('.c-carousel__slide'));
    slide.click();
    const dialog = root.querySelector('.c-zoom');
    assert.ok(dialog, 'a zoom dialog was mounted');
    assert.match(dialog?.querySelector('.c-zoom__img')?.getAttribute('src') ?? '', /a\.jpg/);
    assert.equal(dialog?.getAttribute('aria-label'), 'full-screen image');
  } finally {
    delete (/** @type {any} */ (globalThis)).document;
  }
});
