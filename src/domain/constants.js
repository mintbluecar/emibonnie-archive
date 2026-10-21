// @ts-check

/**
 * Generic speaker roles, used when a speaker has no known person page
 * (host, fan, crowd reaction, or an unnamed speaker).
 * @typedef {'host' | 'fan' | 'speaker' | 'crowd'} Role
 */

/** @type {Role[]} */
export const ROLES = ['host', 'fan', 'speaker', 'crowd'];

/**
 * Where an item is shown on the site: tied to a dated event, folded into a
 * shared story with other items, a standalone post, or not yet sorted.
 * @typedef {'event' | 'shared_story' | 'post' | 'unsorted'} Placement
 */

/** @type {Placement[]} */
export const PLACEMENTS = ['event', 'shared_story', 'post', 'unsorted'];

/**
 * A translation's moderation state: awaiting review, shown on the site, or
 * turned down.
 * @typedef {'pending' | 'published' | 'rejected'} ReviewState
 */

/** @type {ReviewState[]} */
export const REVIEW_STATES = ['pending', 'published', 'rejected'];

/**
 * How many days a header's live date may sit either side of the posting
 * date before the post is no longer treated as "live".
 * @type {number}
 */
export const LIVE_WINDOW_DAYS = 1;

/**
 * How long after its edit window closed a post that can't be read
 * (deleted or unavailable) is still re-fetched before it's finalized.
 * @type {number}
 */
export const GONE_GRACE_HOURS = 24;

/**
 * @typedef {{ code: string, platformCode: string, pattern: RegExp }} LiveTextPattern
 */

/**
 * Phrases in a header that mark a post as a livestream clip, each tied to
 * the platform it ran on. A site's own `extraLivePatterns` (raw strings in
 * `site.json`) are compiled to `RegExp` and appended to this list by the
 * caller; this module stays pure and never reads site settings.
 * @type {LiveTextPattern[]}
 */
export const LIVE_PATTERNS = [
  { code: 'tiktok live', platformCode: 'tiktok', pattern: /tiktok\s*live/i },
  { code: 'ig live', platformCode: 'instagram', pattern: /\b(ig|instagram)\s*live/i },
  { code: 'youtube live', platformCode: 'youtube', pattern: /youtube\s*live/i },
  { code: 'x space', platformCode: 'x', pattern: /\b(x|twitter)\s*space/i },
];
