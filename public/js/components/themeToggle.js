// @ts-check
/**
 * The header's light/dark switch (Task 10c, f): an icon button whose
 * tooltip and accessible name say the current choice (`theme.switch`
 * with `theme.light` / `theme.dark` / `theme.system`), each choice's
 * label carried as `data-label-<choice>` for the click handler. All three icons
 * are drawn; CSS (header.css) shows the one matching `data-choice`, so a
 * click (handled by public/js/core/theme.js) only changes attributes.
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';
import { shownChoice } from '../core/theme.js';
import { THEME_CHOICES } from '../core/themeChoice.js';

/** The switch's tooltip and accessible name for `choice`. @param {import('../core/themeChoice.js').ThemeChoice} choice @returns {string} */
export function themeLabel(choice) {
  return t('theme.switch', { mode: t(`theme.${choice}`) });
}

/** @returns {import('../core/html.js').SafeHtml} */
export function render() {
  const choice = shownChoice();
  return html`
    <button class="btn btn--quiet btn--icon c-header__icon c-theme-toggle" type="button" data-choice="${choice}" title="${themeLabel(choice)}" aria-label="${themeLabel(choice)}"
      ${THEME_CHOICES.map((c) => html` data-label-${c}="${themeLabel(c)}"`)}>
      <svg class="c-theme-toggle__icon c-theme-toggle__icon--light" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>
      <svg class="c-theme-toggle__icon c-theme-toggle__icon--dark" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>
      <svg class="c-theme-toggle__icon c-theme-toggle__icon--system" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"></path></svg>
    </button>
  `;
}
