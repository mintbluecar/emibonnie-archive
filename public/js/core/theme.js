// @ts-check
/**
 * The header's theme switch (Task 10c, f), bound once per page by
 * `mountPage()` (public/js/core/dom.js): a click anywhere on a
 * `.c-theme-toggle` moves to the next choice (light, dark, follow the
 * device), shows and remembers it, updates every switch's icon and
 * label (from the switch's own `data-label-<choice>` attributes, so this
 * module needs no copy), and fires `themechange` on `document` so
 * anything drawn from the theme's colours (`applyColours`) redraws. The
 * switch's markup is public/js/components/themeToggle.js.
 */
import { nextChoice, showChoice, storeChoice } from './themeChoice.js';

/** @typedef {import('./themeChoice.js').ThemeChoice} ThemeChoice */

/** @param {ThemeChoice} choice @returns {void} */
function updateToggles(choice) {
  for (const toggle of document.querySelectorAll('.c-theme-toggle')) {
    const label = toggle.getAttribute(`data-label-${choice}`) ?? '';
    toggle.setAttribute('data-choice', choice);
    toggle.setAttribute('title', label);
    toggle.setAttribute('aria-label', label);
  }
}

/** @param {ThemeChoice} choice @returns {void} */
export function chooseTheme(choice) {
  showChoice(choice);
  storeChoice(choice);
  updateToggles(choice);
  document.dispatchEvent(new CustomEvent('themechange', { detail: { choice } }));
}

let bound = false;

/** Installs the one delegated click listener (idempotent; a no-op outside a browser). @returns {void} */
export function bindThemeToggles() {
  if (bound || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  bound = true;
  document.addEventListener('click', (event) => {
    const target = /** @type {Element|null} */ (event.target);
    if (!target?.closest?.('.c-theme-toggle')) return;
    chooseTheme(nextChoice(shownChoice()));
  });
}

/**
 * The choice in effect: what `<html>` shows ('system' when neither), not
 * what's stored, so the cycle still moves when storage is unavailable.
 * @returns {ThemeChoice}
 */
export function shownChoice() {
  const shown = globalThis.document?.documentElement?.getAttribute('data-theme');
  return shown === 'light' || shown === 'dark' ? shown : 'system';
}
