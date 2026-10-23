// @ts-check
/**
 * Whether the search page focuses its box on load (Task 10b fix round 1,
 * O3, owner's rule): never on a touch device (the keyboard popping up is
 * jarring -- "the user will focus on the search bar themselves if they
 * want to search more"), and on desktop only for the blank search page:
 * no `q`, no filters, nothing at all in the URL's query string. Arriving
 * from a link with a query or filters (a person chip, an event's search
 * icon, `?filters=1`) never steals focus. Pure: the page passes in the
 * pointer check and `location.search`.
 */
import { isBlank } from './searchState.js';

/**
 * @param {{ state: import('./searchState.js').State, urlSearch: string, coarsePointer: boolean }} input
 * @returns {boolean}
 */
export function shouldAutofocus({ state, urlSearch, coarsePointer }) {
  if (coarsePointer) return false;
  return isBlank(state) && (urlSearch === '' || urlSearch === '?');
}
