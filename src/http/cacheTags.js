// @ts-check
/**
 * The `Vercel-Cache-Tag` response header (Plan 2b). Vercel's CDN reads it
 * on a cached response and `invalidateByTag()` from `@vercel/functions`
 * later purges by those tags (https://vercel.com/docs/caching/cdn-cache/purge,
 * read 2026-10-28). Outside Vercel the header is inert, so routes set it
 * unconditionally; tests read it back.
 */

/**
 * Sets one comma-separated tag header, deduped, in the order given.
 * An empty list leaves the response untouched (nothing to purge by).
 * @param {Response} response
 * @param {string[]} tags
 * @returns {Response}
 */
export function withCacheTags(response, tags) {
  const unique = [...new Set(tags)];
  if (unique.length > 0) response.headers.set('vercel-cache-tag', unique.join(','));
  return response;
}
