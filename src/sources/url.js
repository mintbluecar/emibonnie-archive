// @ts-check

const ID_PATTERN = /^\d{1,20}$/u;
const TWEET_HOSTS = new Set(['x.com', 'twitter.com', 'mobile.x.com', 'mobile.twitter.com', 'www.x.com', 'www.twitter.com']);
const STATUS_PATH = /\/status(?:es)?\/(\d{1,20})(?:\/|$)/iu;
/** What separates links in pasted text: whitespace and the brackets, quotes and commas around them. */
const SEPARATORS = /[\s,<>"'()[\]]+/u;
const TRAILING_PUNCTUATION = /[)>\]"'.,;:!?]+$/u;
const SCHEME = /^https?:\/\//iu;

/**
 * Extracts a tweet id from a bare id or an x.com/twitter.com status URL
 * (including mobile hosts, `?s=` query strings, and `/video/1`-style
 * suffixes). Returns `null` for anything else, including profile URLs.
 * @param {string} input
 * @returns {string|null}
 */
export function parseTweetId(input) {
  if (ID_PATTERN.test(input)) return input;

  /** @type {URL} */
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!TWEET_HOSTS.has(url.hostname)) return null;

  const match = STATUS_PATH.exec(url.pathname);
  return match ? match[1] : null;
}

/**
 * Finds every tweet URL in free-form text and returns the ids, unique
 * and in order of first appearance. Links may sit in brackets, quotes or
 * a comma list, end a sentence, or lack a scheme (`x.com/u/status/1`);
 * only x.com/twitter.com hosts count, and a bare number never does.
 * @param {string} text
 * @returns {string[]}
 */
export function extractTweetIds(text) {
  /** @type {string[]} */
  const ids = [];
  const seen = new Set();
  for (const token of text.split(SEPARATORS)) {
    const candidate = token.replace(TRAILING_PUNCTUATION, '');
    if (!candidate.includes('/')) continue;
    const id = parseTweetId(SCHEME.test(candidate) ? candidate : `https://${candidate}`);
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * The canonical x.com link to a status, by id (no handle needed: x.com
 * redirects `/i/status/<id>` to the author's own path).
 * @param {string} id
 * @returns {string}
 */
export function statusUrl(id) {
  return `https://x.com/i/status/${id}`;
}
