// @ts-check
/**
 * The item page's pinned media area (task-4 brief): a `MediaVM|null`
 * (`src/http/contracts.js`) in, the right markup out -- `video` through
 * `videoPlayer.js`, `images` through `carousel.js`, `quote` through
 * `quoteCard.js`, and `null` (the source is gone) as the `sourceGone`
 * note. Kind-agnostic: `MediaVM` is a generic contract shape, not a
 * translation-kind concept, so this lives under `components/`, not
 * `kinds/translation/`.
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';
import * as videoPlayer from './videoPlayer.js';
import * as carousel from './carousel.js';
import * as quoteCard from './quoteCard.js';

/** @returns {import('../core/html.js').SafeHtml} */
function goneMarkup() {
  return html`<p class="c-video__gone c-media-box__gone">${t('item.sourceGone')}</p>`;
}

/**
 * @param {{ media: import('../../../src/http/contracts.js').MediaVM|null }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render({ media }) {
  const body = !media
    ? goneMarkup()
    : media.type === 'video' ? videoPlayer.render(media)
    : media.type === 'images' ? carousel.render(media)
    : quoteCard.render(media);
  return html`<div class="c-media-box">${body}</div>`;
}

/**
 * @param {Element} el the element containing the rendered `.c-media-box`
 * @param {{ media: import('../../../src/http/contracts.js').MediaVM|null, kind: string, sourceId: string }} props
 * @returns {void}
 */
export function bind(el, { media, kind, sourceId }) {
  const box = el.querySelector('.c-media-box');
  if (!box || !media) return;
  if (media.type === 'video') videoPlayer.bind(box, { kind, sourceId, variants: media.variants });
  else if (media.type === 'images') carousel.bind(box, media);
  else quoteCard.bind(box, { quote: media, kind, sourceId });
}
