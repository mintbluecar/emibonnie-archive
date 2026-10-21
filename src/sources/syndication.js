// @ts-check

const ENDPOINT = 'https://cdn.syndication.twimg.com/tweet-result';

/**
 * Fetches a tweet from X's syndication endpoint. Returns the parsed JSON
 * (a normal tweet, a `TweetTombstone`, or similar), or `null` on any
 * failure (network error, redirect, non-2xx, bad JSON).
 * @param {{fetchImpl: typeof fetch}} deps
 * @param {string} id
 * @returns {Promise<any|null>}
 */
async function fetchSyndication(deps, id) {
  const url = `${ENDPOINT}?id=${id}&token=${id}`;
  try {
    const res = await deps.fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** One entry of `SOURCES` (see `index.js`). */
export const syndicationSource = { name: 'syndication', fetch: fetchSyndication };
