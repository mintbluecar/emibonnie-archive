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
 * `lang="<site.sourceLanguage>"`.
 */
import { html } from '../core/html.js';
import { site, t } from '../core/site.js';

const THAI_RUN = /[\p{Script=Thai}]+/gu;

/**
 * Splits `text` into an array of plain strings and `lang`-tagged `SafeHtml`
 * spans for its Thai-script runs. `html\`…\`` escapes the plain parts and
 * the already-safe spans alike, so a hostile value (e.g. `<script>`) is
 * never unescaped by this split.
 * @param {string} text
 * @returns {(string|import('../core/html.js').SafeHtml)[]}
 */
function thaiSpans(text) {
  /** @type {(string|import('../core/html.js').SafeHtml)[]} */
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(THAI_RUN)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(html`<span lang="${site.sourceLanguage}">${match[0]}</span>`);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
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
 * @param {import('../../../src/http/contracts.js').BubbleVM} bubble
 * @returns {import('../core/html.js').SafeHtml}
 */
function nonNoteBubble(bubble) {
  if (bubble.kind === 'speech') return speechBubble(bubble);
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

/**
 * Applies each coloured element's `data-c` as the `--c` custom property
 * (CSP-safe: no inline `style` attribute is ever written server-side).
 * @param {Element} el
 * @returns {void}
 */
export function bind(el) {
  for (const node of el.querySelectorAll('[data-c]')) {
    const colour = node.getAttribute('data-c');
    if (colour) /** @type {HTMLElement} */ (node).style.setProperty('--c', colour);
  }
}
