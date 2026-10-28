// @ts-check
/**
 * The signed-in user's own session state (Plan 2a Task 12): one call for
 * "who am I?", shared by the me page and the add page. `getJson` and
 * `postJson` stay in `core/api.js` -- they're transport, not session.
 */
import { getJson } from './api.js';

/**
 * `GET /api/me`: `{ user: null }` signed out, otherwise the session's
 * public fields (`via`, `handle`, `displayName`, `isOwner`,
 * `isTranslator`, `needsName`).
 * @returns {Promise<{ user: null | { via: 'x'|'google', handle: string|null, displayName: string|null,
 *   isOwner: boolean, isTranslator: boolean, needsName: boolean } }>}
 */
export function getMe() {
  return getJson('/api/me');
}
