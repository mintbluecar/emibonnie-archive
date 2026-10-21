// @ts-check
/**
 * Public search: validates every parameter (anything out of bounds is a
 * `BadRequest`, never clamped silently), runs src/repo/search.js over the
 * requested kinds, and presents the page of results with each one's event
 * and matching lines. Never names a kind.
 */
import { BadRequest } from '../sources/errors.js';
import { PLACEMENTS } from '../domain/constants.js';
import { searchItems } from '../repo/search.js';
import { kindsOf, eventRefOf, presenterContext, previewsFor } from './cards.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('../http/contracts.js').SearchResponse} SearchResponse */
/** @typedef {import('../repo/search.js').SearchFilters} SearchFilters */
/**
 * @typedef {{ q?: unknown, people?: unknown, peopleMode?: unknown, categories?: unknown, placements?: unknown,
 *   kinds?: unknown, eventSlug?: unknown, accountHandle?: unknown, clientId?: unknown, from?: unknown, to?: unknown,
 *   limit?: unknown, offset?: unknown }} SearchParams
 *   As parsed from the query string: numbers may arrive as digit strings.
 */

const Q_MIN = 2;
const Q_MAX = 100;
const LIMIT_MAX = 50;
const OFFSET_MAX = 1000;
const LIST_MAX = 50;
const TEXT_MAX = 200;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** @param {unknown} value */
const absent = (value) => value === undefined || value === null || value === '';

/**
 * @param {string} name @param {unknown} value @param {number} max @param {number} [fallback]
 * @returns {number}
 */
function integer(name, value, max, fallback) {
  if (absent(value) && fallback !== undefined) return fallback;
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > max) throw new BadRequest(`${name} must be an integer from 0 to ${max}`);
  return n;
}

/** @param {unknown} q @returns {string|null} */
function queryOf(q) {
  if (absent(q)) return null;
  if (typeof q !== 'string') throw new BadRequest('q must be text');
  const text = q.normalize('NFC').trim();
  const length = [...text].length;
  if (length < Q_MIN || length > Q_MAX) throw new BadRequest(`q must be ${Q_MIN} to ${Q_MAX} characters`);
  return text;
}

/**
 * @template T
 * @param {string} name @param {unknown} value @param {(item: unknown) => T} each
 * @returns {T[]|undefined}
 */
function listOf(name, value, each) {
  if (absent(value)) return undefined;
  if (!Array.isArray(value) || value.length > LIST_MAX) throw new BadRequest(`${name} must be a list of at most ${LIST_MAX}`);
  return [...new Set(value.map(each))];
}

/** @param {string} name @param {unknown} value @param {(s: string) => boolean} [ok] @returns {string|undefined} */
function textOf(name, value, ok = () => true) {
  if (absent(value)) return undefined;
  if (typeof value !== 'string' || value.length > TEXT_MAX || !ok(value)) throw new BadRequest(`${name} is not valid`);
  return value;
}

/** @param {string} name @param {readonly string[]} allowed @returns {(item: unknown) => string} */
const oneOf = (name, allowed) => (item) => {
  if (typeof item !== 'string' || !allowed.includes(item)) throw new BadRequest(`${name}: unknown value`);
  return item;
};

/** @param {string} name @returns {(item: unknown) => number} */
const id = (name) => (item) => {
  const n = integer(name, item, Number.MAX_SAFE_INTEGER);
  if (n < 1) throw new BadRequest(`${name} must hold positive ids`);
  return n;
};

/** @param {string} value */
const isDate = (value) => DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/** @param {SearchParams} params @returns {SearchFilters} */
function filtersOf(params) {
  const peopleMode = params.peopleMode ?? 'any';
  if (peopleMode !== 'any' && peopleMode !== 'all') throw new BadRequest('peopleMode must be any or all');
  return {
    people: listOf('people', params.people, id('people')),
    peopleMode,
    categories: listOf('categories', params.categories, id('categories')),
    placements: listOf('placements', params.placements, oneOf('placements', PLACEMENTS)),
    eventSlug: textOf('eventSlug', params.eventSlug),
    accountHandle: textOf('accountHandle', params.accountHandle)?.replace(/^@/, ''),
    clientId: absent(params.clientId) ? undefined : id('clientId')(params.clientId),
    from: textOf('from', params.from, isDate),
    to: textOf('to', params.to, isDate),
  };
}

/**
 * @param {ViewDeps} deps
 * @param {SearchParams} params
 * @returns {Promise<SearchResponse>}
 */
export async function search(deps, params) {
  const registry = kindsOf(deps);
  const q = queryOf(params.q);
  const listed = listOf('kinds', params.kinds, oneOf('kinds', Object.keys(registry)));
  const names = listed?.length ? listed : Object.keys(registry);
  const limit = integer('limit', params.limit, LIMIT_MAX, LIMIT_MAX);
  const offset = integer('offset', params.offset, OFFSET_MAX, 0);
  const kinds = names.map((name) => registry[name]);
  const { count, ids } = await searchItems(deps.db, { q, kinds, filters: filtersOf(params), limit, offset });
  if (ids.length === 0) return { count, results: [] };
  const entries = await previewsFor(deps, ids, await presenterContext(deps));
  const results = entries.map(({ card, details, preview }) => ({
    ...preview, event: eventRefOf(card.event), matchLines: q === null ? [] : registry[card.kind].search.matchLines(details, q),
  }));
  return { count, results };
}
