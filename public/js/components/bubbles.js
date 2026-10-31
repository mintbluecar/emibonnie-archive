// @ts-check
/**
 * Renders a translation's `BubbleVM[]` (src/http/contracts.js) as chat
 * bubbles: speech (with a collapsed avatar/name on a `cont` continuation),
 * crowd asides, plain lines, and footnotes collected into one `.notes`
 * block at the end, however they were interleaved in `bubbles`. Pure view
 * models in, markup out -- this never resolves a person itself.
 *
 * A11y: every emoji speaker shows a visible name -- a never-mapped
 * marker (`name: null`) shows `item.unknownSpeaker` ("unknown speaker")
 * in that same spot, rather than an avatar `aria-label` (review round 1,
 * M2: a joint bubble's name is always visible text, since it's a join of
 * every component's name, so a solo bubble does the same, instead of two
 * different unmapped-marker treatments -- see docs/.../1b plan,
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
        <div class="c-bubbles__bub">${thaiSpans(bubble.text)}</div>
      </div>
    `;
  }
  const name = bubble.name ?? t('item.unknownSpeaker');
  return html`
    <div class="c-bubbles__msg"${bubble.colour ? html` data-c="${bubble.colour}"` : ''}>
      ${bubble.emoji ? html`<div class="c-bubbles__avatar"><span class="c-emoji">${bubble.emoji}</span></div>` : html`<div class="c-bubbles__avatar c-bubbles__avatar--none" aria-hidden="true"></div>`}
      <div class="c-bubbles__bub">
        <div class="c-bubbles__name">${name}</div>
        ${thaiSpans(bubble.text)}
      </div>
    </div>
  `;
}

/**
 * A joint line (2+ speakers at once): one neutral bubble (no `data-c`),
 * its avatars stacked in line order. A never-mapped component's name
 * joins in as `item.unknownSpeaker`, same as a solo unmapped marker's
 * visible name (M2): no per-avatar `aria-label` here, so a screen reader
 * reads it once, from the visible joined name, not again per avatar.
 * @param {import('../../../src/http/contracts.js').JointBubble} bubble
 * @returns {import('../core/html.js').SafeHtml}
 */
function jointBubble(bubble) {
  if (bubble.cont) {
    return html`
      <div class="c-bubbles__msg c-bubbles__msg--cont">
        <div class="c-bubbles__avatar c-bubbles__avatar--blank" aria-hidden="true"></div>
        <div class="c-bubbles__bub">${thaiSpans(bubble.text)}</div>
      </div>
    `;
  }
  const name = bubble.parts.map((p) => p.name ?? t('item.unknownSpeaker')).join(' & ');
  return html`
    <div class="c-bubbles__msg">
      <div class="c-bubbles__avatars">
        ${bubble.parts.map((p) => html`<div class="c-bubbles__avatar"><span class="c-emoji">${p.emoji}</span></div>`)}
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

/**
 * One compact line's speaker: the emoji (a joint line's, side by side),
 * as an image named for the speaker(s), since there's no visible name
 * here; a speaker with no emoji (a bare ':' marker, fix round 2) shows
 * its name as text instead. A continuation, crowd or plain line has none.
 * @param {import('../../../src/http/contracts.js').BubbleVM} bubble
 * @returns {import('../core/html.js').SafeHtml|string}
 */
function compactWho(bubble) {
  if (bubble.kind === 'speech' && !bubble.cont && !bubble.emoji) {
    return html`<span class="c-bubbles-compact__name">${bubble.name ?? t('item.unknownSpeaker')}:</span> `;
  }
  if (bubble.kind === 'speech' && !bubble.cont) {
    return html`<span class="c-emoji" role="img" aria-label="${bubble.name ?? t('item.unknownSpeaker')}">${bubble.emoji}</span> `;
  }
  if (bubble.kind === 'joint' && !bubble.cont) {
    const names = bubble.parts.map((p) => p.name ?? t('item.unknownSpeaker')).join(' & ');
    return html`<span class="c-emoji" role="img" aria-label="${names}">${bubble.parts.map((p) => p.emoji)}</span> `;
  }
  return '';
}

/**
 * The compact preview (Task 9b; mockups/people-me-v1.html's entries):
 * the same lines as one paragraph of "emoji text" runs, which CSS clamps
 * to two lines. Footnotes are left out.
 * @param {{ bubbles: import('../../../src/http/contracts.js').BubbleVM[] }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function renderCompact(props) {
  const lines = props.bubbles.filter((b) => b.kind !== 'note');
  return html`<p class="c-bubbles-compact">${lines.map((b, i) => html`${i > 0 ? ' ' : ''}${compactWho(b)}${thaiSpans(/** @type {{ text: string }} */ (b).text)}`)}</p>`;
}

/** @param {Element} el @returns {void} */
export function bind(el) {
  applyColours(el);
}
