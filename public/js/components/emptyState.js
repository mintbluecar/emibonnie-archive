// @ts-check
/**
 * A generic empty state (no results, no items yet, …). The message is a
 * prop the caller already resolved through `t()`, so this component holds
 * no copy of its own and works for any page.
 */
import { html } from '../core/html.js';

/**
 * @param {{ message: string, icon?: string }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render(props) {
  const { message, icon = '🔍' } = props;
  return html`
    <div class="c-empty-state">
      <span class="c-empty-state__icon" aria-hidden="true">${icon}</span>
      <p class="c-empty-state__message">${message}</p>
    </div>
  `;
}
