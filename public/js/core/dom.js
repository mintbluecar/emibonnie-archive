// @ts-check
/**
 * DOM helpers used by page and component code. No framework: direct DOM
 * calls only, kept to this one small module so the escaping rule (only
 * `SafeHtml` ever reaches `innerHTML`) and event delegation are each done
 * in exactly one place.
 */
import { SafeHtml } from './html.js';

/**
 * Replaces `el`'s content with already-escaped markup. Throws if `safeHtml`
 * didn't come from `html`\`…\` or `raw()`, so a plain string can never
 * reach `innerHTML` by accident.
 * @param {{ innerHTML: string }} el
 * @param {SafeHtml} safeHtml
 * @returns {void}
 */
export function mount(el, safeHtml) {
  if (!(safeHtml instanceof SafeHtml)) {
    throw new TypeError('mount() expects SafeHtml, from html`…` or raw()');
  }
  el.innerHTML = safeHtml.toString();
}

/**
 * `mount()`, plus marking `root` ready for an e2e test to wait on
 * (`#app[data-ready]`) before inspecting the page -- every page's first
 * paint, whichever of success, 404 or a load error it ends up being,
 * calls this (instead of plain `mount()`) exactly once, so the marker
 * lives in this one shared place rather than in every page (review
 * round 2, C1). Never used for a page's later, partial re-renders
 * (e.g. item.js's body-only reload) -- those stay plain `mount()`.
 * @param {Element} root
 * @param {SafeHtml} safeHtml
 * @returns {void}
 */
export function mountPage(root, safeHtml) {
  mount(root, safeHtml);
  root.setAttribute('data-ready', '');
}

/**
 * A delegated event listener: `fn(event, target)` runs when `event` fires
 * on, or bubbles from, a descendant of `el` matching `selector`.
 * @param {{ addEventListener: (event: string, fn: (e: any) => void) => void, contains: (node: any) => boolean }} el
 * @param {string} selector
 * @param {string} event
 * @param {(e: any, target: any) => void} fn
 * @returns {void}
 */
export function on(el, selector, event, fn) {
  el.addEventListener(event, (e) => {
    const start = e.target;
    const target = start && typeof start.closest === 'function' ? start.closest(selector) : null;
    if (target && el.contains(target)) fn(e, target);
  });
}

/** A plain 6-digit hex colour (`#rrggbb`), the only shape `data-c` may carry. */
const COLOUR_PATTERN = /^#[0-9a-f]{6}$/i;

/**
 * Applies every `[data-c]` descendant's colour as its own `--c` custom
 * property, but only when that `data-c` value is a plain `#rrggbb` hex
 * colour -- it ultimately traces back to a person's stored colour, not
 * this component's own markup, so it's validated here, the one place
 * every colour-carrying component's `bind()` goes through, before it
 * ever reaches a CSS custom property. CSP-safe: no inline `style`
 * attribute is ever written server-side, only `setProperty()` here.
 * @param {Element} el
 * @returns {void}
 */
export function applyColours(el) {
  for (const node of el.querySelectorAll('[data-c]')) {
    const colour = node.getAttribute('data-c');
    if (colour && COLOUR_PATTERN.test(colour)) /** @type {HTMLElement} */ (node).style.setProperty('--c', colour);
  }
}
