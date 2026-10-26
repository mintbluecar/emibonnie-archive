// @ts-check
/**
 * Rate limits (Plan 2a Task 3). One frozen table `LIMITS` pairs each named
 * action with `{ limit, windowSeconds }`; `limit()` enforces it against
 * `rate_limits`, keyed by `${name}:${subject}`. IP subjects are stored
 * hashed so a raw IP never reaches the table; a missing IP becomes
 * `ip:unknown`.
 *
 * Old window rows are pruned opportunistically: on about 1 in 100 hits,
 * windows more than two days old are deleted. The roll uses `deps.random`
 * when given, so tests can pin it.
 */
import { createHash } from 'node:crypto';
import { RateLimited } from '../domain/errors.js';
import { recordHit, pruneBefore } from '../repo/rateLimits.js';

/** @typedef {{ db: import('../db/common.js').Db, env?: Record<string, string|undefined>, now?: () => Date, random?: () => number }} LimitDeps */

/** The agreed limits, keyed by action name. Frozen. */
export const LIMITS = Object.freeze({
  signIn: { limit: 10, windowSeconds: 900 },
  addPreview: { limit: 60, windowSeconds: 3600 },
  add: { limit: 20, windowSeconds: 3600 },
  edit: { limit: 60, windowSeconds: 3600 },
  followUps: { limit: 10, windowSeconds: 3600 },
  setName: { limit: 5, windowSeconds: 3600 },
  deleteAccount: { limit: 3, windowSeconds: 86400 },
  report: { limit: 5, windowSeconds: 3600 },
});

/** Names whose subject is an IP address (hashed) rather than a user id. */
const IP_KEYED = new Set(['signIn', 'report']);

/**
 * Hash an IP with the auth secret so the stored key is opaque.
 * @param {string} authSecret
 * @param {string} ip
 * @returns {string} `ip:` plus the hex SHA-256 of `authSecret + ip`
 */
export function hashIpSubject(authSecret, ip) {
  return `ip:${createHash('sha256').update(authSecret + ip).digest('hex')}`;
}

/**
 * Enforce `name`'s limit for `subject`. IP-keyed names expect a raw IP
 * (or null); anything else is used as-is for the subject.
 * @param {LimitDeps} deps
 * @param {keyof typeof LIMITS} name
 * @param {string|null} subject
 * @returns {Promise<void>}
 */
export async function limit(deps, name, subject) {
  const { limit: max, windowSeconds } = LIMITS[name];

  let key;
  if (IP_KEYED.has(name)) {
    key = subject === null ? 'ip:unknown' : hashIpSubject(deps.env?.AUTH_SECRET ?? '', subject);
  } else {
    key = String(subject);
  }

  const now = (deps.now ?? (() => new Date()))();
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);

  const hits = await deps.db.transaction(async (tx) => {
    const count = await recordHit(tx, { key: `${name}:${key}`, windowStart });

    // Opportunistic prune: about 1% of all hits, regardless of name.
    if ((deps.random ?? Math.random)() < 0.01) {
      await pruneBefore(tx, new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000));
    }
    return count;
  }, { actor: 'system' });

  if (hits > max) throw new RateLimited();
}
