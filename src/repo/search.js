// @ts-check
/**
 * search: the one public query whose shape the visitor steers, so every
 * value is bound through a `$n` placeholder and only fixed, code-chosen
 * fragments (and each kind's own `textClause`/`rank`, which interpolate
 * nothing but a placeholder index) are ever spliced in. Every query
 * includes `visibleItem`. Inputs arrive already validated
 * (src/services/search.js).
 *
 * With a query `q`, an item matches when any requested kind's text clause
 * does, or one of its (non-ignored) tags' `norm`, its event's name, a
 * person's name on it, or its translator's handle contains `q`. Ordering:
 * the kind's `rank` (best first), then newest, then id -- always total.
 * `accountHandle` also matches a handle the account held before a change.
 */
import { visibleItem } from './visibility.js';
import { EVENT_NOT_DELETED } from './items.js';
import { norm } from '../domain/text.js';

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */
/** @typedef {{ name: string, search: { textClause(n: number): string, rank(n: number): string } }} SearchKind */
/**
 * @typedef {{ people?: number[], peopleMode?: 'any'|'all', categories?: number[], placements?: string[],
 *   eventSlug?: string, accountHandle?: string, clientId?: number, from?: string, to?: string }} SearchFilters
 * @typedef {{ q: string|null, kinds: SearchKind[], filters: SearchFilters }} SearchInput
 */

/** `%…%` for `like`/`ilike`, with the pattern's own wildcards (and the escape character) taken literally. @param {string} text */
function containsPattern(text) {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`;
}

class Params {
  /** @type {unknown[]} */
  values = [];

  /** @param {unknown} value @returns {number} the placeholder index */
  index(value) {
    this.values.push(value);
    return this.values.length;
  }

  /** @param {unknown} value @returns {string} */
  bind(value) {
    return `$${this.index(value)}`;
  }
}

/**
 * The single-value and list filters: each key's condition, given its bound placeholder.
 * @type {[keyof SearchFilters, (ph: string) => string][]}
 */
const SIMPLE_FILTERS = [
  ['categories', (ph) => `i.category_id = any(${ph}::int[])`],
  ['placements', (ph) => `i.placement = any(${ph}::text[])`],
  ['eventSlug', (ph) => `exists (select 1 from events es where es.id = i.event_id and es.slug = ${ph})`],
  ['accountHandle', (ph) => `exists (select 1 from accounts ah where ah.id = i.credited_account_id
    and (lower(ah.handle) = lower(${ph}::text) or ah.meta->'previousHandles' ? lower(${ph}::text)))`],
  ['clientId', (ph) => `i.client_id = ${ph}`],
  ['from', (ph) => `i.occurred_on >= ${ph}::date`],
  ['to', (ph) => `i.occurred_on <= ${ph}::date`],
];

/** @param {SearchFilters} f @param {Params} p @returns {string|null} */
function peopleCondition(f, p) {
  if (!f.people?.length) return null;
  const ids = p.bind(f.people);
  return f.peopleMode === 'all'
    ? `i.id in (select item_id from item_people where person_id = any(${ids}::bigint[])
         group by item_id having count(distinct person_id) = cardinality(${ids}::bigint[]))`
    : `exists (select 1 from item_people ipf where ipf.item_id = i.id and ipf.person_id = any(${ids}::bigint[]))`;
}

/** @param {SearchFilters} f @param {Params} p @returns {string[]} */
function filterConditions(f, p) {
  const people = peopleCondition(f, p);
  const given = SIMPLE_FILTERS.filter(([key]) => f[key] !== undefined && !(Array.isArray(f[key]) && f[key].length === 0));
  return [...(people ? [people] : []), ...given.map(([key, condition]) => condition(p.bind(f[key])))];
}

/** @param {string} q @param {SearchKind[]} kinds @param {Params} p */
function textCondition(q, kinds, p) {
  const pattern = p.index(containsPattern(q));
  const tag = p.bind(containsPattern(norm(q.replace(/^#/, ''))));
  const byKind = kinds.map((kind) => `(i.kind = ${p.bind(kind.name)} and ${kind.search.textClause(pattern)})`);
  return `(${[
    ...byKind,
    `exists (select 1 from item_tags it join tags t on t.id = it.tag_id where it.item_id = i.id and not t.ignored and t.norm like ${tag})`,
    `exists (select 1 from events en where en.id = i.event_id and en.name ilike $${pattern})`,
    `exists (select 1 from item_people ipn join people pn on pn.id = ipn.person_id
       where ipn.item_id = i.id and pn.deleted_at is null and pn.display_name ilike $${pattern})`,
    `exists (select 1 from accounts an where an.id = i.credited_account_id and an.handle ilike $${pattern})`,
  ].join('\n or ')})`;
}

/** @param {string} q @param {SearchKind[]} kinds @param {Params} p */
function rankExpression(q, kinds, p) {
  if (kinds.length === 0) return '0';
  const raw = p.index(q);
  const whens = kinds.map((kind) => `when i.kind = ${p.bind(kind.name)} then ${kind.search.rank(raw)}`);
  return `coalesce(case ${whens.join(' ')} end, 0)`;
}

/** @param {SearchInput} input @param {Params} p */
function whereClause({ q, kinds, filters }, p) {
  const conditions = [visibleItem('i'), EVENT_NOT_DELETED, `i.kind = any(${p.bind(kinds.map((k) => k.name))}::text[])`];
  conditions.push(...filterConditions(filters, p));
  if (q !== null) conditions.push(textCondition(q, kinds, p));
  return conditions.join('\n and ');
}

/**
 * The page query, exported for the EXPLAIN test.
 * @param {SearchInput & { limit: number, offset: number }} input
 * @returns {{ sql: string, params: unknown[] }}
 */
export function searchSql(input) {
  const p = new Params();
  const where = whereClause(input, p);
  const rank = input.q === null ? '0' : rankExpression(input.q, input.kinds, p);
  const sql = `select i.id, ${rank} as rank from items i where ${where}
    order by rank desc, i.posted_at desc nulls last, i.id desc
    limit ${p.bind(input.limit)} offset ${p.bind(input.offset)}`;
  return { sql, params: p.values };
}

/** @param {SearchInput} input @returns {{ sql: string, params: unknown[] }} */
function countSql(input) {
  const p = new Params();
  return { sql: `select count(*)::int as n from items i where ${whereClause(input, p)}`, params: p.values };
}

/**
 * @param {Tx} db
 * @param {SearchInput & { limit: number, offset: number }} input
 * @returns {Promise<{ count: number, ids: number[] }>}
 */
export async function searchItems(db, input) {
  const counted = countSql(input);
  const { rows } = await db.query(counted.sql, counted.params);
  if (input.limit === 0 || rows[0].n === 0) return { count: rows[0].n, ids: [] };
  const page = searchSql(input);
  const found = await db.query(page.sql, page.params);
  return { count: rows[0].n, ids: found.rows.map((row) => row.id) };
}
