// @ts-check
/**
 * Validation shared by the services that read query-string numbers:
 * anything out of bounds is a `BadRequest`, never clamped silently.
 */
import { BadRequest } from '../domain/errors.js';

/** The hub pages' per-section page size: at most this many, and this many by default. */
export const HUB_LIMIT_MAX = 50;
/** The furthest a hub section may be paged into. */
export const HUB_OFFSET_MAX = 10000;

/** @param {unknown} value */
export const absent = (value) => value === undefined || value === null || value === '';

/**
 * A whole number from 0 to `max` (a digit string from the query, or a
 * number), else `fallback` when absent and one is given.
 * @param {string} name @param {unknown} value @param {number} max @param {number} [fallback]
 * @returns {number}
 */
export function integer(name, value, max, fallback) {
  if (absent(value) && fallback !== undefined) return fallback;
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > max) throw new BadRequest(`${name} must be an integer from 0 to ${max}`);
  return n;
}

/**
 * A hub page's `limit` (1 to 50, default 50) and `offset` (0 to 10000,
 * default 0), applied to each of its per-kind sections.
 * @param {{ limit?: unknown, offset?: unknown }} [params]
 * @returns {{ limit: number, offset: number }}
 */
export function hubPage(params = {}) {
  const limit = integer('limit', params.limit, HUB_LIMIT_MAX, HUB_LIMIT_MAX);
  if (limit < 1) throw new BadRequest(`limit must be an integer from 1 to ${HUB_LIMIT_MAX}`);
  return { limit, offset: integer('offset', params.offset, HUB_OFFSET_MAX, 0) };
}

/**
 * A hub section's listing order: `'asc'` (event order, the default) or
 * `'desc'` ("newest first"); anything else is a `BadRequest`.
 * @param {unknown} value
 * @returns {'asc'|'desc'}
 */
export function orderParam(value) {
  if (absent(value)) return 'asc';
  if (value === 'asc' || value === 'desc') return value;
  throw new BadRequest("order must be 'asc' or 'desc'");
}
