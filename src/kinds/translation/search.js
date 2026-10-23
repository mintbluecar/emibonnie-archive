// @ts-check
/**
 * The translation kind's part of a search (src/repo/search.js builds the
 * rest). Both SQL fragments refer to the searched item as `i` and
 * interpolate nothing but their placeholder index: the value itself is
 * always bound. `textClause` matches any part's body against an `ilike`
 * pattern (served by the `translation_parts_body_trgm` index); `rank` is
 * the best-matching part's `word_similarity` to the raw query.
 */
import { splitLines } from '../../domain/lines.js';
import { excerptAround } from '../../domain/text.js';
import { componentOf } from './presenter.js';

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
 * How a matching line reads in a result: a speech line's marker becomes
 * the emoji its bubble shows on the item page (a known person's standard
 * emoji; a generic role's or an unmapped marker's own), with no colon,
 * as the search mockup shows it. Any other line stays as written. A long
 * line's text is cut to a window around the match (`excerptAround`, Task
 * 9b), after the emoji, so the speaker always shows.
 * @param {string} line @param {string} q @param {SpeakerMap} speakers @param {PresentContext} ctx
 * @returns {string}
 */
function shownLine(line, q, speakers, ctx) {
  const [parsed] = splitLines(line);
  if (parsed?.kind !== 'speech') return excerptAround(line, q);
  return `${parsed.markers.map((marker) => shownSpeaker(componentOf(marker, speakers, ctx))).join('')} ${excerptAround(parsed.text, q)}`;
}

/**
 * The lines (trimmed) containing `q`, case-insensitively, at most 3,
 * each long one cut to a window around the match. Matched on the
 * verbatim text; with `ctx` (the search service always
 * passes it), each is shown with its speaker resolved (`shownLine`).
 * @param {{ body: string, speakers?: SpeakerMap }} details
 * @param {string} q
 * @param {PresentContext} [ctx]
 * @returns {string[]}
 */
function matchLines(details, q, ctx) {
  const needle = q.normalize('NFC').toLowerCase();
  const found = details.body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.normalize('NFC').toLowerCase().includes(needle))
    .slice(0, MAX_MATCH_LINES);
  return ctx ? found.map((line) => shownLine(line, q, details.speakers ?? {}, ctx)) : found.map((line) => excerptAround(line, q));
}

export const search = { textClause, rank, matchLines };
