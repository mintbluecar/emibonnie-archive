// @ts-check

const ID_PATTERN = /^\d{1,20}$/u;
const TWEET_HOSTS = new Set(['x.com', 'twitter.com', 'mobile.x.com', 'mobile.twitter.com', 'www.x.com', 'www.twitter.com']);
const STATUS_PATH = /\/status(?:es)?\/(\d{1,20})(?:\/|$)/u;
const URL_PATTERN = /https?:\/\/\S+/gu;

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
 * and in order of first appearance.
 * @param {string} text
 * @returns {string[]}
 */
export function extractTweetIds(text) {
  /** @type {string[]} */
  const ids = [];
  const seen = new Set();
  for (const candidate of text.match(URL_PATTERN) ?? []) {
    const id = parseTweetId(candidate);
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
