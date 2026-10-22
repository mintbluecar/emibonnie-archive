// @ts-check
/**
 * The stored-variant `<video>` player (task-4 brief): `video.twimg.com`
 * 403s a foreign `Referer`, but the spike (docs/spikes.md, Plan 1a Task 2)
 * found that a request with *no* `Referer` header at all -- the real
 * `no-referrer` condition -- succeeds. The page-wide `<meta
 * name="referrer" content="no-referrer">` (added to every page, since
 * `<video>` itself has no `referrerpolicy` attribute) gets that.
 *
 * On phones every clip's box is capped at `max-height: 40svh` with
 * letterboxing (`object-fit: contain`), so a vertical clip never pushes
 * the translation off-screen; a full-screen button escapes that cap.
 * `aspect-ratio` is set in `bind()` via `style.setProperty`, never a
 * server-rendered inline `style` attribute (CSP: no inline styles).
 */
import { html } from '../core/html.js';
import { mount, on } from '../core/dom.js';
import { getJson, ApiError } from '../core/api.js';
import { t } from '../core/site.js';

/** Variants at or below this bitrate (bps) qualify for the "large screen" pick. */
const LARGE_SCREEN_BITRATE_CAP = 2_200_000;

/**
 * The smallest variant for a small screen; otherwise the largest at or
 * below `LARGE_SCREEN_BITRATE_CAP`, or the smallest if none qualifies.
 * @param {import('../../../src/http/contracts.js').VariantVM[]} variants
 * @param {boolean} isSmall
 * @returns {import('../../../src/http/contracts.js').VariantVM}
 */
export function pickVariant(variants, isSmall) {
  const smallest = [...variants].sort((a, b) => a.bitrate - b.bitrate)[0];
  if (isSmall) return smallest;
  const qualifying = variants.filter((v) => v.bitrate <= LARGE_SCREEN_BITRATE_CAP).sort((a, b) => b.bitrate - a.bitrate);
  return qualifying[0] ?? smallest;
}

/** @returns {import('../core/html.js').SafeHtml} */
function fullScreenButton() {
  return html`
    <button type="button" class="c-video__full" aria-label="${t('item.fullScreen')}">
      <span aria-hidden="true">⤢</span>
    </button>
  `;
}

/**
 * @param {{ variants: import('../../../src/http/contracts.js').VariantVM[], width: number, height: number }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render({ variants, width, height }) {
  const best = pickVariant(variants, false);
  const aspect = height > 0 ? width / height : 1;
  return html`
    <div class="c-video" data-aspect="${aspect}">
      <video class="c-video__el" controls playsinline preload="metadata" width="${width}" height="${height}">
        ${best ? html`<source src="${best.url}">` : ''}
      </video>
      ${fullScreenButton()}
    </div>
  `;
}

/** @returns {import('../core/html.js').SafeHtml} */
function goneMarkup() {
  return html`<p class="c-video__gone">${t('item.sourceGone')}</p>`;
}

/**
 * Whether the viewport is phone-width -- the same 860px breakpoint
 * `src/styles/layout.css` uses. `false` wherever `matchMedia` isn't
 * available (non-browser test environments), so `render()`'s own
 * "large screen" default stands in those cases.
 * @returns {boolean}
 */
function isSmallScreen() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 859px)').matches;
}

/**
 * Refetches `/api/video/:kind/:sourceId` once after the `<video>` fires
 * `error`; a 404 (or any other failure) swaps the whole box for the
 * `sourceGone` note. Never retries past the one refetch.
 * @param {Element} el @param {{ kind: string, sourceId: string }} target @param {boolean} isSmall
 * @returns {Promise<void>}
 */
async function recover(el, { kind, sourceId }, isSmall) {
  try {
    const data = await getJson(`/api/video/${encodeURIComponent(kind)}/${encodeURIComponent(sourceId)}`);
    const variants = /** @type {import('../../../src/http/contracts.js').VariantVM[]} */ (data.variants ?? []);
    const best = pickVariant(variants, isSmall);
    const video = /** @type {HTMLVideoElement|null} */ (el.querySelector('video'));
    const source = video?.querySelector('source');
    if (!best || !video || !source) throw new ApiError(404);
    source.setAttribute('src', best.url);
    video.load();
  } catch {
    mount(el, goneMarkup());
  }
}

/**
 * `render()` always picks the "large screen" variant (it has no DOM, so
 * it can't know the real viewport) -- `bind()` is where the actual
 * screen size is known, so it swaps in the small variant here when
 * appropriate, before wiring the error/full-screen handlers.
 * @param {Element} el @param {import('../../../src/http/contracts.js').VariantVM[]} variants
 * @returns {void}
 */
function applyScreenVariant(el, variants) {
  if (!isSmallScreen() || variants.length === 0) return;
  const best = pickVariant(variants, true);
  const video = el.querySelector('.c-video__el');
  const source = video?.querySelector('source');
  if (source) source.setAttribute('src', best.url);
}

/**
 * @param {Element} el the element containing the rendered `.c-video` box
 * @param {{ kind: string, sourceId: string, variants?: import('../../../src/http/contracts.js').VariantVM[] }} target
 * @returns {void}
 */
export function bind(el, target) {
  const box = el.querySelector('.c-video');
  const aspect = box?.getAttribute('data-aspect');
  if (box && aspect) /** @type {HTMLElement} */ (box).style.setProperty('--aspect', aspect);
  applyScreenVariant(el, target.variants ?? []);
  // `error` on a <video> never bubbles (unlike `click`), so it's listened
  // for directly on the element itself, not through `on()`'s delegation.
  const video = el.querySelector('.c-video__el');
  if (video) {
    let recovering = false;
    video.addEventListener('error', () => {
      if (recovering) return;
      recovering = true;
      recover(el, target, isSmallScreen());
    });
  }
  on(el, '.c-video__full', 'click', () => {
    const current = /** @type {any} */ (el.querySelector('video'));
    if (!current) return;
    if (current.requestFullscreen) current.requestFullscreen();
    else if (current.webkitEnterFullscreen) current.webkitEnterFullscreen();
  });
}
