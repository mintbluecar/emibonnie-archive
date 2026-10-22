// @ts-check
/**
 * The event page's own path prefix (`src/pages.js`: `{ path: '/e/:slug',
 * file: 'event.html' }`). `public/js` can't import `src/**` (eslint layer
 * rule: it's server-only code with Node built-ins), so this one small
 * constant is the shared place any *new* client code reads the prefix
 * from, rather than retyping `'/e/'` again (review round 1, IMPORTANT #1
 * -- "take the prefix from src/pages.js ... don't hardcode it"). Older
 * call sites (`public/js/components/eventCard.js`,
 * `public/js/pages/event.js`'s own `slugFromPath`) already hardcode it
 * once each and are unchanged by this file; this is only for new code.
 */
export const EVENT_PATH_PREFIX = '/e/';

/** @param {string} slug @returns {string} */
export function eventUrl(slug) {
  return `${EVENT_PATH_PREFIX}${encodeURIComponent(slug)}`;
}
