// @ts-check

/**
 * Generic speaker roles, used when a speaker has no known person page
 * (host, fan, crowd reaction, or an unnamed speaker). Task 5 extends this
 * file with the rest of the engine's shared constants (`KINDS`,
 * `PLACEMENTS`, `REVIEW_STATES`); this file holds only `ROLES` for now.
 * @typedef {'host' | 'fan' | 'speaker' | 'crowd'} Role
 */

/** @type {Role[]} */
export const ROLES = ['host', 'fan', 'speaker', 'crowd'];
