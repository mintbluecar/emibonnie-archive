// @ts-check
/**
 * Dropdown options with more than text, for the site's own dropdown
 * (public/js/core/selectMenu.js): a lead drawn before the option's text
 * (a person's emoji) and a detail after it, smaller and lighter (their IG
 * handle). The `<option>`'s own text stays just the label, so typeahead,
 * search and the closed button all read it.
 */
import { html } from './html.js';

/** @typedef {import('./html.js').SafeHtml} SafeHtml */

/**
 * A dropdown option with a lead (drawn before its text, e.g. an emoji)
 * and a detail (drawn after it, smaller and lighter). The `<option>`'s
 * own text stays just `label`, so typeahead and the button read it.
 * @param {string} value @param {string} label @param {{ lead?: string, detail?: string }} [extras]
 * @returns {SafeHtml}
 */
export function menuOption(value, label, { lead = '', detail = '' } = {}) {
  return html`<option value="${value}" data-lead="${lead}" data-detail="${detail}">${label}</option>`;
}

/**
 * A person as a dropdown option: emoji, name, then IG handle.
 * @param {string} value
 * @param {{ displayName: string, emoji: string, igHandle?: string|null }} person
 * @returns {SafeHtml}
 */
export function personOption(value, person) {
  return menuOption(value, person.displayName, { lead: person.emoji, detail: person.igHandle ? `@${person.igHandle}` : '' });
}
