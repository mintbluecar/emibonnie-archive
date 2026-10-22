// @ts-check
/**
 * The whole-page fallback for an initial-load failure that isn't a 404
 * (review round 1, I5): the page shell plus `emptyState`, with the one
 * generic `page.loadFailed` copy key -- shared by every page's `start()`
 * (home has none of its own fetch-failure handling to unify; event,
 * item, person and account all had their own ad hoc "just `throw err`"
 * before this, which left `#app` blank and threw unhandled on anything
 * but a 404). Never rethrows: a transient network hiccup shows this
 * message instead of crashing the page blank.
 */
import { mount } from '../core/dom.js';
import { t } from '../core/site.js';
import * as pageShell from '../components/pageShell.js';
import * as emptyState from '../components/emptyState.js';

/**
 * @param {Element} root
 * @param {{ active?: import('../components/tabBar.js').TabKey }} [options]
 * @returns {void}
 */
export function mountLoadError(root, { active } = {}) {
  mount(root, pageShell.render({ active, compact: true, content: emptyState.render({ message: t('page.loadFailed') }) }));
}
