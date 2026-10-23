// @ts-check
/**
 * The visitor's theme choice (Task 10c, f): 'light', 'dark' or 'system'
 * (follow the device), remembered per browser in `localStorage` and shown
 * as `data-theme` on `<html>` ('system' sets none). No imports, so the
 * blocking `<head>` script (public/js/boot/theme.js) stays tiny. Storage
 * can be missing or throw (private windows, blocked site data), so every
 * read and write is guarded and the page works without it.
 * @typedef {'light'|'dark'|'system'} ThemeChoice
 */

export const THEME_KEY = 'theme';
/** @type {ThemeChoice[]} */
export const THEME_CHOICES = ['light', 'dark', 'system'];

/** @param {unknown} value @returns {value is ThemeChoice} */
function isChoice(value) {
  return value === 'light' || value === 'dark' || value === 'system';
}

/** The stored choice, or 'system'. @returns {ThemeChoice} */
export function storedChoice() {
  try {
    const value = globalThis.localStorage?.getItem(THEME_KEY);
    return isChoice(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Sets (or, for 'system', removes) `data-theme` on `<html>`. @param {ThemeChoice} choice @returns {void} */
export function showChoice(choice) {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

/** Remembers `choice` ('system' forgets any). @param {ThemeChoice} choice @returns {void} */
export function storeChoice(choice) {
  try {
    if (choice === 'system') globalThis.localStorage?.removeItem(THEME_KEY);
    else globalThis.localStorage?.setItem(THEME_KEY, choice);
  } catch {
    // Not remembered: the choice still holds for this page.
  }
}

/** The choice after `choice` in the switch's cycle: light, dark, follow the device. @param {ThemeChoice} choice @returns {ThemeChoice} */
export function nextChoice(choice) {
  return THEME_CHOICES[(THEME_CHOICES.indexOf(choice) + 1) % THEME_CHOICES.length];
}

/**
 * Whether the page is dark now: a forced choice, else the device.
 * @returns {boolean}
 */
export function isDark() {
  const forced = globalThis.document?.documentElement?.getAttribute('data-theme');
  if (forced === 'dark') return true;
  if (forced === 'light') return false;
  const win = globalThis.window;
  return typeof win?.matchMedia === 'function' && win.matchMedia('(prefers-color-scheme: dark)').matches;
}
