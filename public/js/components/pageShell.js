// @ts-check
/**
 * The chrome shared by every page: the site header, the tab bar / top
 * nav, the page's own content, then the footer -- one place, so every
 * page (home, event, person, account, item, …) wires
 * header+tabs+footer the same way instead of composing them itself
 * (Task 3 review #3). `compact` is passed straight through to `header`
 * (a page with its own title, like the event page, drops the
 * tagline/badge row). The tab bar goes inside the header (Task 9b), so
 * desktop CSS can make the two one top bar; on a phone it's still fixed
 * to the bottom.
 *
 * Returns `ShellHtml`, not plain `SafeHtml`: `mountPage()` (public/js/
 * core/dom.js) only accepts `ShellHtml`, so a page can't mount without
 * going through this `render()` (spec "5. The shell is not optional").
 */
import { html, ShellHtml } from '../core/html.js';
import * as header from './header.js';
import * as footer from './footer.js';
import * as tabBar from './tabBar.js';

/**
 * @param {{ active?: import('./tabBar.js').TabKey, compact?: boolean,
 *   wide?: boolean, headerProps?: Record<string, unknown>,
 *   content: import('../core/html.js').SafeHtml }} props
 *   `headerProps`: passed through to `header.render()` alongside `compact`
 *   (an in-place search page's `search` row: `inlineSearchView.headerProps`)
 *   -- every other page leaves it out, so its header has no search box.
 *   `wide`: the import review's table needs the room -- adds
 *   `container--wide` (src/styles/layout.css) to `main`.
 * @returns {import('../core/html.js').ShellHtml}
 */
export function render({ active, compact = false, wide = false, headerProps = {}, content }) {
  const mainClass = wide ? 'container container--wide' : 'container';
  const markup = html`
    ${header.render({ compact, ...headerProps, nav: tabBar.render({ active }) })}
    <main class="${mainClass}">${content}</main>
    ${footer.render()}
  `;
  return new ShellHtml(markup.toString());
}
