// @ts-check
/**
 * A `HomeEvent` card (src/http/contracts.js): its representative picture
 * on top when it has one (owner, 2026-10-23), then the name, date,
 * hashtag, and the total visible-item count across every kind.
 */
import { html } from '../core/html.js';
import { dayLabel } from '../core/format.js';
import { eventHref } from '../core/routes.js';
import * as thumb from './thumb.js';

/**
 * @param {{ event: import('../../../src/http/contracts.js').HomeEvent }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props) {
  const { event } = props;
  const total = Object.values(event.counts).reduce((sum, n) => sum + n, 0);
  return html`
    <a class="card card--flush c-event-card" href="${eventHref(event.slug)}">
      ${thumb.render(event.thumb, { cover: true })}
      <div class="c-event-card__body">
        <div class="c-event-card__text">
          <strong class="c-event-card__name">${event.name}</strong>
          <small class="meta c-event-card__meta">${dayLabel(event.occurredOn)}</small>
          ${event.hashtag ? html`<small class="meta c-event-card__tag" title="#${event.hashtag}">#${event.hashtag}</small>` : ''}
        </div>
        <span class="badge badge--accent c-event-card__count">${total}</span>
      </div>
    </a>
  `;
}
