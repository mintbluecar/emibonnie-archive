// @ts-check
/**
 * The link allowlist for links that leave the site (Task 10c): an
 * outbound URL is only ever built here, and only kept when it is https
 * on an allowed host. Anything else comes back `null`, so a caller
 * renders plain text instead of a link.
 */

/** Hosts an outbound link may point to. */
const ALLOWED_HOSTS = new Set(['x.com']);

/**
 * `url` when it is https on an allowed host, else `null`.
 * @param {string} url
 * @returns {string|null}
 */
export function externalHref(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_HOSTS.has(parsed.hostname) ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * X's hashtag search for `tag` (written with or without its `#`):
 * `https://x.com/hashtag/<tag>`, the tag percent-encoded.
 * @param {string} tag
 * @returns {string|null}
 */
export function hashtagHref(tag) {
  const bare = tag.replace(/^#/, '');
  return bare ? externalHref(`https://x.com/hashtag/${encodeURIComponent(bare)}`) : null;
}
