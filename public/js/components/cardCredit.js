// @ts-check
/**
 * The translator's own dedicated credit line at the end of a preview or
 * result card (owner, 2026-10-23: "translated by: @xxxx", linked to
 * their X profile -- this replaces the translate icon before the
 * handle). Shared by previewCard.js and resultCard.js so the markup and
 * the "no account at all -> no line" rule live in one place.
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';

/**
 * `null`/no account at all: no line. An account with no `accountUrl`
 * (a kind that credits an account but defines no profile link) still
 * gets the line, as plain "@handle" text instead of a link.
 * @param {{ accountHandle: string|null, accountUrl?: string|null }} card
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(card) {
  if (!card.accountHandle) return html``;
  const handle = card.accountHandle;
  const link = card.accountUrl
    ? html`<a class="c-card-credit__link" href="${card.accountUrl}" target="_blank" rel="noopener noreferrer">@${handle}</a>`
    : html`@${handle}`;
  return html`<p class="meta c-card-credit">${t('item.translatedBy')} ${link}</p>`;
}
