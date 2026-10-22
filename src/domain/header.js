// @ts-check
import { splitLines } from './lines.js';
import { norm } from './text.js';
import { localYear } from './dates.js';

/**
 * @typedef {import('./lines.js').Line} Line
 * @typedef {import('./constants.js').LiveTextPattern} LiveTextPattern
 * @typedef {{code: string, platformCode: string, date: string|null}} HeaderLive
 * @typedef {{
 *   keyword: string|null,
 *   tags: string[], // as written (compare with norm); never classified by shape
 *   personTags: string[], // normed
 *   live: HeaderLive|null,
 *   context: string|null,
 * }} Header
 */

const HASHTAG = /#(\w+)/g;
const BRACKET_DATE = /\[(\d{2})(\d{2})(\d{2})\]/;
const SLASH_DATE = /\b(\d{1,2})\/(\d{1,2})\b/;

/** @param {string} text */
function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** @param {string} text */
function isKeywordLine(text) {
  if (wordCount(text) < 2) return false;
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  if (letters.length === 0) return false;
  const upper = letters.filter((ch) => /\p{Lu}/u.test(ch));
  return upper.length / letters.length >= 0.7;
}

/** @param {Line[]} headerLines */
function findKeyword(headerLines) {
  return headerLines.find((line) => isKeywordLine(line.text))?.text ?? null;
}

/** @param {string} text */
function hashtagTokensOf(text) {
  return [...text.matchAll(HASHTAG)].map((match) => match[1]);
}

/**
 * Never guesses a tag's role from its shape: only a known person handle
 * or the ignore list decide. Anything else is just a tag.
 * @param {string} tag
 * @param {{ignoredHashtags: string[], personHandles: string[]}} opts
 * @returns {'person'|'ignored'|'tag'}
 */
function classifyTag(tag, { ignoredHashtags, personHandles }) {
  const normed = norm(tag);
  if (personHandles.some((handle) => norm(handle) === normed)) return 'person';
  if (ignoredHashtags.some((ignored) => norm(ignored) === normed)) return 'ignored';
  return 'tag';
}

/**
 * Adds `value` unless an entry with the same `norm` is already there.
 * @param {string[]} list
 * @param {string} value
 */
function pushUnique(list, value) {
  if (!list.some((entry) => norm(entry) === norm(value))) list.push(value);
}

/**
 * Scans every header line for `#tag` tokens, bucketing each into a person
 * tag (matches a known handle) or a plain tag -- never guessed from the
 * tag's shape. A dropped ignored hashtag joins neither bucket.
 * Duplicates are dropped by `norm`, keeping the first spelling.
 * @param {Line[]} headerLines
 * @param {{ignoredHashtags: string[], personHandles: string[]}} opts
 */
function collectTags(headerLines, opts) {
  /** @type {Record<'person'|'tag', string[]>} */
  const buckets = { person: [], tag: [] };
  for (const line of headerLines) {
    for (const tag of hashtagTokensOf(line.text)) {
      const kind = classifyTag(tag, opts);
      if (kind === 'ignored') continue;
      // Plain tags keep their written case (stored as `tags.display`);
      // person tags are compared as keys, so are normed.
      pushUnique(buckets[kind], kind === 'tag' ? tag : norm(tag));
    }
  }
  return { personTags: buckets.person, tags: buckets.tag };
}

/**
 * @param {Line[]} headerLines
 * @param {LiveTextPattern[]} livePatterns
 */
function findLiveMatch(headerLines, livePatterns) {
  for (const line of headerLines) {
    const found = livePatterns.find((candidate) => candidate.pattern.test(line.text));
    if (found) return { code: found.code, platformCode: found.platformCode, lineText: line.text };
  }
  return null;
}

/**
 * A live date from `[YYMMDD]`, or from `d/m` combined with the posting
 * year. Without a `postedAt`, a bare `d/m` cannot be resolved to a year
 * without reading the clock, so it is left `null` (see dates.js).
 * @param {string} lineText
 * @param {string|null|undefined} postedAt
 * @param {string|undefined} timezone
 * @returns {string|null}
 */
function extractLiveDate(lineText, postedAt, timezone) {
  const bracket = BRACKET_DATE.exec(lineText);
  if (bracket) {
    const [, yy, mm, dd] = bracket;
    return `20${yy}-${mm}-${dd}`;
  }
  const slash = SLASH_DATE.exec(lineText);
  if (!slash || !postedAt || !timezone) return null;
  const [, day, month] = slash;
  const year = localYear(postedAt, timezone);
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * @param {Line} line
 * @param {string|null} keyword
 * @param {string|null} liveLineText
 */
function isConsumedLine(line, keyword, liveLineText) {
  if (line.text === keyword || line.text === liveLineText) return true;
  return hashtagTokensOf(line.text).length > 0;
}

/**
 * Header lines that contributed nothing else (not the keyword, not a
 * live-pattern match, no hashtag) — leftover descriptive text, if any.
 * @param {Line[]} headerLines
 * @param {string|null} keyword
 * @param {string|null} liveLineText
 */
function buildContext(headerLines, keyword, liveLineText) {
  const leftover = headerLines.filter((line) => !isConsumedLine(line, keyword, liveLineText)).map((line) => line.text);
  return leftover.length > 0 ? leftover.join('\n') : null;
}

/**
 * Parses the header of a post's text: the lines before its first speech
 * line. Pure — `postedAt`/`timezone` are only used to resolve a bare
 * `d/m` live date's year; no clock is ever read.
 * @param {string} text
 * @param {{
 *   ignoredHashtags?: string[],
 *   personHandles?: string[],
 *   livePatterns?: LiveTextPattern[],
 *   postedAt?: string|null,
 *   timezone?: string,
 * }} options
 * @returns {Header}
 */
export function parseHeader(text, options) {
  const { ignoredHashtags = [], personHandles = [], livePatterns = [], postedAt = null, timezone } = options;
  const lines = splitLines(text);
  const firstSpeechIndex = lines.findIndex((line) => line.kind === 'speech');
  const headerLines = firstSpeechIndex === -1 ? lines : lines.slice(0, firstSpeechIndex);

  const keyword = findKeyword(headerLines);
  const { personTags, tags } = collectTags(headerLines, { ignoredHashtags, personHandles });
  const liveMatch = findLiveMatch(headerLines, livePatterns);
  const live = liveMatch
    ? { code: liveMatch.code, platformCode: liveMatch.platformCode, date: extractLiveDate(liveMatch.lineText, postedAt, timezone) }
    : null;

  return {
    keyword,
    tags,
    personTags,
    live,
    context: buildContext(headerLines, keyword, liveMatch?.lineText ?? null),
  };
}
