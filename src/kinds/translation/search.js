// @ts-check
/**
 * The translation kind's part of a search (src/repo/search.js builds the
 * rest). Both SQL fragments refer to the searched item as `i` and
 * interpolate nothing but their placeholder index: the value itself is
 * always bound. `textClause` matches any part's body against an `ilike`
 * pattern (served by the `translation_parts_body_trgm` index); `rank` is
 * the best-matching part's `word_similarity` to the raw query.
 */
import { excerptAround } from '../../domain/text.js';
import { componentOf, fixedSpeakerOf } from './presenter.js';
import { partLines } from '../../domain/lineFixes.js';

/** @typedef {import('../defineKind.js').PresentContext} PresentContext */
/** @typedef {import('../../domain/speakers.js').SpeakerMap} SpeakerMap */

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
  return `i.id in (select tp.item_id from translation_parts tp where tp.body ilike ${placeholder(patternIndex)} and not tp.pending
    and tp.item_id not in (select item_id from translations where subbed))`;
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
 * A speaker as a match line shows it: their emoji, or -- for a speaker
 * with none (a bare ':' marker, fix round 2) -- their name and a colon,
 * or the bare ':' as written when it was never mapped.
 * @param {{ emoji: string, name: string|null }} speaker @returns {string}
 */
function shownSpeaker({ emoji, name }) {
  if (emoji) return emoji;
  return name ? `${name}:` : ':';
}

/**
 * The lines (trimmed) containing `q`, case-insensitively, at most 3,
 * each long one cut to a window around the match. Matched on the
 * verbatim text; with `ctx` (the search service always
 * passes it), each is shown with its speaker resolved (`shownLine`), and
 * a line-level fix resolves its speaker from the fix.
 * @param {{ body: string, parts?: string[], fixes?: import('../../domain/lineFixes.js').LineFix[], speakers?: SpeakerMap }} details
 * @param {string} q
 * @param {PresentContext} [ctx]
 * @returns {string[]}
 */
function matchLines(details, q, ctx) {
  const needle = q.normalize('NFC').toLowerCase();
  // No context: the verbatim lines only (markers as written), as before.
  if (!ctx) {
    const found = details.body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.normalize('NFC').toLowerCase().includes(needle))
      .slice(0, MAX_MATCH_LINES);
    return found.map((line) => excerptAround(line, q));
  }
  const parts = details.parts ?? [details.body];
  const found = partLines(parts, details.fixes ?? [])
    .filter((line) => line.text.normalize('NFC').toLowerCase().includes(needle))
    .slice(0, MAX_MATCH_LINES);
  return found.map((raw) => {
    const line = /** @type {any} */ (raw);
    if (line.fixed) {
      const { emoji, name } = fixedSpeakerOf(line.fixed, line.marker, ctx);
      const speaker = shownSpeaker({ emoji, name });
      return `${speaker} ${excerptAround(line.text, q)}`.trim();
    }
    if (line.kind !== 'speech') return excerptAround(line.text, q);
    return `${line.markers.map((/** @type {string} */ marker) => shownSpeaker(componentOf(marker, details.speakers ?? {}, ctx))).join('')} ${excerptAround(line.text, q)}`;
  });
}

export const search = { textClause, rank, matchLines };
