// @ts-check
/** A `HomeEvent` card (src/http/contracts.js): name, date, hashtag, and the total visible-item count across every kind. */
import { html } from '../core/html.js';
import { dayLabel } from '../core/format.js';

/**
 * @param {{ event: import('../../../src/http/contracts.js').HomeEvent }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props) {
  const { event } = props;
  const total = Object.values(event.counts).reduce((sum, n) => sum + n, 0);
  return html`
    <a class="c-event-card" href="/e/${event.slug}">
      <div>
        <strong class="c-event-card__name">${event.name}</strong>
        <small class="c-event-card__meta">
          ${dayLabel(event.occurredOn)}${event.hashtag ? html` · #${event.hashtag}` : ''}
        </small>
      </div>
      <span class="c-event-card__count">${total}</span>
    </a>
  `;
}
