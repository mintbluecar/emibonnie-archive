// @ts-check
/**
 * A capped image carousel (task-4 brief): on phones the box is capped at
 * `max-height: 40svh` (same rule as `videoPlayer.js`'s `.c-video`), one
 * slide shown at a time, swipe or arrow buttons to move, an `n / total`
 * counter, and tapping a slide opens `zoomDialog.js`'s full-screen zoom.
 * `aspect-ratio` is set per slide in `bind()` via `style.setProperty`
 * (CSP: no inline `style` attributes).
 */
import { html } from '../core/html.js';
import { on } from '../core/dom.js';
import { t } from '../core/site.js';
import { mountZoomDialog } from './zoomDialog.js';

/** A swipe shorter than this (px) is treated as a tap/click, not a slide move. */
const SWIPE_THRESHOLD = 40;

/**
 * @param {import('../../../src/http/contracts.js').ImageVM} image @param {number} index @param {boolean} shown
 * @returns {import('../core/html.js').SafeHtml}
 */
function slide(image, index, shown) {
  const aspect = image.height > 0 ? image.width / image.height : 1;
  return html`
    <button type="button" class="c-carousel__slide" data-index="${index}" data-aspect="${aspect}" ${shown ? '' : 'hidden'}>
      <img class="c-carousel__img" src="${image.url}" alt="" loading="lazy" decoding="async">
    </button>
  `;
}

/**
 * @param {{ images: import('../../../src/http/contracts.js').ImageVM[] }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render({ images }) {
  const many = images.length > 1;
  return html`
    <div class="c-carousel" data-count="${images.length}">
      <div class="c-carousel__track">${images.map((image, i) => slide(image, i, i === 0))}</div>
      ${many ? html`
        <button type="button" class="c-carousel__prev" aria-label="${t('item.prevImage')}">‹</button>
        <button type="button" class="c-carousel__next" aria-label="${t('item.nextImage')}">›</button>
        <span class="c-carousel__count" aria-live="polite">1 / ${images.length}</span>
      ` : ''}
    </div>
  `;
}

/**
 * The currently shown slide's index. Found by filtering in plain JS, not
 * a `:not([hidden])` selector -- `test/helpers/miniDom.js`'s selector
 * engine (used to drive this `bind()` in tests) only ever needs to
 * support the class/attribute shapes this codebase's components already
 * use, and `:not()` isn't one of them.
 * @param {Element} box @returns {number}
 */
function currentIndex(box) {
  const shown = [...box.querySelectorAll('.c-carousel__slide')].find((el) => !(/** @type {HTMLElement} */ (el).hidden));
  return Number(shown?.getAttribute('data-index') ?? '0');
}

/**
 * Shows slide `index` (wrapped into range) and applies its aspect ratio.
 * @param {Element} box @param {number} index @returns {void}
 */
function showSlide(box, index) {
  const slides = box.querySelectorAll('.c-carousel__slide');
  const total = slides.length;
  const wrapped = ((index % total) + total) % total;
  for (const el of slides) {
    const isTarget = Number(el.getAttribute('data-index')) === wrapped;
    /** @type {HTMLElement} */ (el).hidden = !isTarget;
    if (isTarget) /** @type {HTMLElement} */ (box).style.setProperty('--aspect', el.getAttribute('data-aspect') ?? '1');
  }
  const counter = box.querySelector('.c-carousel__count');
  if (counter) counter.textContent = `${wrapped + 1} / ${total}`;
}

/**
 * Wires the arrow buttons, a swipe gesture on the track, and tap-to-zoom.
 * @param {Element} el the element containing the rendered `.c-carousel`
 * @param {{ images: import('../../../src/http/contracts.js').ImageVM[] }} props
 * @returns {void}
 */
export function bind(el, { images }) {
  const box = el.querySelector('.c-carousel');
  if (!box) return;
  showSlide(box, 0);
  const openZoom = mountZoomDialog(box);
  // Shared with bindSwipe(): a drag (|delta| >= SWIPE_THRESHOLD) sets this,
  // so the click a pointerup also fires doesn't also open the zoom dialog
  // (review round 1, IMPORTANT #3).
  const drag = { justDragged: false };
  on(box, '.c-carousel__prev', 'click', () => showSlide(box, currentIndex(box) - 1));
  on(box, '.c-carousel__next', 'click', () => showSlide(box, currentIndex(box) + 1));
  on(box, '.c-carousel__slide', 'click', (_e, target) => {
    if (drag.justDragged) return;
    const index = Number(target.getAttribute('data-index') ?? '0');
    if (images[index]) openZoom(images[index], target);
  });
  bindSwipe(box, drag);
}

/**
 * @param {Element} box @param {{ justDragged: boolean }} drag shared with
 *   the slide click handler in `bind()`, so a drag can suppress the click
 *   that follows it
 * @returns {void}
 */
function bindSwipe(box, drag) {
  const track = box.querySelector('.c-carousel__track');
  if (!track) return;
  let startX = 0;
  track.addEventListener('pointerdown', (/** @type {any} */ e) => { startX = e.clientX; drag.justDragged = false; });
  track.addEventListener('pointerup', (/** @type {any} */ e) => {
    const delta = e.clientX - startX;
    if (Math.abs(delta) < SWIPE_THRESHOLD) return;
    drag.justDragged = true;
    showSlide(box, currentIndex(box) + (delta < 0 ? 1 : -1));
  });
}
