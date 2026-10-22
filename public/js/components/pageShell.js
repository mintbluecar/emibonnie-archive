// @ts-check
/**
 * The chrome shared by every page: the site header, the tab bar / top
 * nav, the page's own content, then the footer -- one place, so every
 * page (home, event, and later search/person/account/…) wires
 * header+tabs+footer the same way instead of composing them itself
 * (Task 3 review #3). `compact` is passed straight through to `header`
 * (a page with its own title, like the event page, drops the
 * tagline/badge row).
 */
import { html } from '../core/html.js';
import * as header from './header.js';
import * as footer from './footer.js';
import * as tabBar from './tabBar.js';

/**
 * @param {{ active?: import('./tabBar.js').TabKey, compact?: boolean, content: import('../core/html.js').SafeHtml }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render({ active, compact = false, content }) {
  return html`
    ${header.render({ compact })}
    ${tabBar.render({ active })}
    <main class="container">${content}</main>
    ${footer.render()}
  `;
}
