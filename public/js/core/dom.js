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
