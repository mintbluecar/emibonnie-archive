// @ts-check
/**
 * The translation kind's part of a search (src/repo/search.js builds the
 * rest). Both SQL fragments refer to the searched item as `i` and
 * interpolate nothing but their placeholder index: the value itself is
 * always bound. `textClause` matches any part's body against an `ilike`
 * pattern (served by the `translation_parts_body_trgm` index); `rank` is
 * the best-matching part's `word_similarity` to the raw query.
 */

const MAX_MATCH_LINES = 3;

/** @param {number} n */
function placeholder(n) {
  if (!Number.isInteger(n) || n < 1) throw new TypeError(`placeholder index must be a positive integer, got ${String(n)}`);
  return `$${n}`;
}

/**
 * Uncorrelated (`i.id in (…)`, not a correlated `exists`): the core query
 * ORs this with other clauses, and under an OR Postgres keeps a subquery
 * as a subplan -- a correlated one would probe each item's parts by
 * primary key, while this one runs once, as a hashed subplan over the
 * trigram index.
 * @param {number} patternIndex the bound `ilike` pattern (`%…%`, wildcards escaped)
 */
function textClause(patternIndex) {
  return `i.id in (select tp.item_id from translation_parts tp where tp.body ilike ${placeholder(patternIndex)})`;
}

/**
 * `word_similarity(q, body)`: how well q matches the best-matching extent
 * of a part (1 for a whole-word match), so a long translation isn't
 * scored down for its length the way `similarity` would.
 * @param {number} queryIndex the bound raw query
 */
function rank(queryIndex) {
  return `(select max(word_similarity(${placeholder(queryIndex)}, tp.body)) from translation_parts tp where tp.item_id = i.id)`;
}

/**
 * The verbatim lines (trimmed) containing `q`, case-insensitively, at most 3.
 * @param {{ body: string }} details
 * @param {string} q
 * @returns {string[]}
 */
function matchLines(details, q) {
  const needle = q.normalize('NFC').toLowerCase();
  return details.body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.normalize('NFC').toLowerCase().includes(needle))
    .slice(0, MAX_MATCH_LINES);
}

export const search = { textClause, rank, matchLines };
