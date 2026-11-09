// @ts-check
/**
 * The site's dropdown's keys (public/js/core/selectMenu.js), after the
 * WAI-ARIA select-only combobox pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/
 */

/**
 * The part of a dropdown the keys drive.
 * @typedef {{ active: number, select: HTMLSelectElement, open: (at?: 'first'|'last'|number) => void,
 *   setActive: (i: number) => void, chooseActive: () => void, close: (refocus?: boolean) => void }} Menu
 */

/** @param {KeyboardEvent} e @returns {boolean} a printable key, no modifier */
export const isChar = (e) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

/**
 * Keys while the list is closed: each opens it, at the chosen option or an end.
 * @type {Record<string, (m: Menu) => void>}
 */
export const CLOSED_KEYS = {
  ArrowDown: (m) => m.open(),
  ArrowUp: (m) => m.open(),
  Enter: (m) => m.open(),
  ' ': (m) => m.open(),
  Home: (m) => m.open('first'),
  End: (m) => m.open('last'),
};

/**
 * Keys while the list is open (in the search box, Space, Home and End
 * type and move the caret as usual, so they're left out there).
 * @type {Record<string, (m: Menu, e: KeyboardEvent) => void>}
 */
export const OPEN_KEYS = {
  ArrowDown: (m) => m.setActive(m.active + 1),
  ArrowUp: (m, e) => (e.altKey ? m.chooseActive() : m.setActive(m.active - 1)),
  Home: (m) => m.setActive(0),
  End: (m) => m.setActive(Infinity),
  PageDown: (m) => m.setActive(m.active + 10),
  PageUp: (m) => m.setActive(m.active - 10),
  Enter: (m) => m.chooseActive(),
  ' ': (m) => m.chooseActive(),
  Escape: (m) => m.close(true),
};
export const SEARCH_PASS = new Set([' ', 'Home', 'End']);
