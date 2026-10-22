// @ts-check
/**
 * Renders a translation's `BubbleVM[]` (src/http/contracts.js) as chat
 * bubbles: speech (with a collapsed avatar/name on a `cont` continuation),
 * crowd asides, plain lines, and footnotes collected into one `.notes`
 * block at the end, however they were interleaved in `bubbles`. Pure view
 * models in, markup out -- this never resolves a person itself.
 *
 * A11y: every emoji speaker shows a visible name, or (an unmapped marker,
 * `name: null`) an `aria-label` on its avatar (see docs/.../1b plan,
 * "Additional constraints" → Accessibility). Thai-script runs get
 * `lang="<site.sourceLanguage>"` (via public/js/core/thai.js, shared with
 * public/js/kinds/translation/detail.js).
 */
import { html } from '../core/html.js';
import { site, t } from '../core/site.js';
import { applyColours } from '../core/dom.js';
import { thaiSpans as thaiSpansIn } from '../core/thai.js';

/** @param {string} text @returns {(string|import('../core/html.js').SafeHtml)[]} */
function thaiSpans(text) {
  return thaiSpansIn(text, site.sourceLanguage);
}

/**
 * @param {import('../../../src/http/contracts.js').SpeechBubble} bubble
 * @returns {import('../core/html.js').SafeHtml}
 */
function speechBubble(bubble) {
  if (bubble.cont) {
    return html`
      <div class="c-bubbles__msg c-bubbles__msg--cont"${bubble.colour ? html` data-c="${bubble.colour}"` : ''}>
        <div class="c-bubbles__avatar c-bubbles__avatar--blank" aria-hidden="true"></div>
        <div class="c-bubbles__bub msg cont">${thaiSpans(bubble.text)}</div>
      </div>
    `;
  }
  const hasName = bubble.name !== null;
  return html`
    <div class="c-bubbles__msg"${bubble.colour ? html` data-c="${bubble.colour}"` : ''}>
      <div class="c-bubbles__avatar" ${hasName ? '' : html`aria-label="${t('item.unknownSpeaker')}" role="img"`}>${bubble.emoji}</div>
      <div class="c-bubbles__bub">
        ${hasName ? html`<div class="c-bubbles__name">${bubble.name}</div>` : ''}
        ${thaiSpans(bubble.text)}
      </div>
    </div>
  `;
}

/**
 * A joint line (2+ speakers at once): one neutral bubble (no `data-c`),
 * its avatars stacked in line order. A never-mapped component's own
 * avatar gets the same aria-label an unmapped solo marker would, and its
 * name joins in as `item.unknownSpeaker`, same text.
 * @param {import('../../../src/http/contracts.js').JointBubble} bubble
 * @returns {import('../core/html.js').SafeHtml}
 */
function jointBubble(bubble) {
  if (bubble.cont) {
    return html`
      <div class="c-bubbles__msg c-bubbles__msg--cont">
        <div class="c-bubbles__avatar c-bubbles__avatar--blank" aria-hidden="true"></div>
        <div class="c-bubbles__bub msg cont">${thaiSpans(bubble.text)}</div>
      </div>
    `;
  }
  const name = bubble.parts.map((p) => p.name ?? t('item.unknownSpeaker')).join(' & ');
  return html`
    <div class="c-bubbles__msg c-bubbles__msg--joint">
      <div class="c-bubbles__avatars">
        ${bubble.parts.map((p) => html`<div class="c-bubbles__avatar" ${p.name === null ? html`aria-label="${t('item.unknownSpeaker')}" role="img"` : ''}>${p.emoji}</div>`)}
      </div>
      <div class="c-bubbles__bub">
        <div class="c-bubbles__name">${name}</div>
        ${thaiSpans(bubble.text)}
      </div>
    </div>
  `;
}

/**
 * @param {import('../../../src/http/contracts.js').BubbleVM} bubble
 * @returns {import('../core/html.js').SafeHtml}
 */
function nonNoteBubble(bubble) {
  if (bubble.kind === 'speech') return speechBubble(bubble);
  if (bubble.kind === 'joint') return jointBubble(bubble);
  if (bubble.kind === 'crowd') return html`<p class="c-bubbles__crowd">${thaiSpans(bubble.text)}</p>`;
  return html`<p class="c-bubbles__plain">${thaiSpans(bubble.text)}</p>`;
}

/**
 * @param {import('../../../src/http/contracts.js').BubbleVM[]} bubbles
 * @returns {import('../core/html.js').SafeHtml}
 */
function notesBlock(bubbles) {
  const notes = bubbles.filter((b) => b.kind === 'note');
  if (notes.length === 0) return html``;
  return html`
    <div class="c-bubbles__notes">
      ${notes.map((note) => html`<p class="c-bubbles__note">${note.mark} ${thaiSpans(note.text)}</p>`)}
    </div>
  `;
}

/**
 * @param {{ bubbles: import('../../../src/http/contracts.js').BubbleVM[] }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props) {
  const { bubbles } = props;
  return html`
    <div class="c-bubbles">
      ${bubbles.filter((b) => b.kind !== 'note').map(nonNoteBubble)}
      ${notesBlock(bubbles)}
    </div>
  `;
}

/** @param {Element} el @returns {void} */
export function bind(el) {
  applyColours(el);
}
