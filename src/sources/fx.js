// @ts-check

const ENDPOINT = 'https://api.fxtwitter.com/2/status';

/**
 * Fetches a tweet from FxTwitter. Returns the parsed JSON
 * (`{status, thread, author, code}`), or `null` on any failure (network
 * error, redirect, non-2xx, bad JSON).
 * @param {{fetchImpl: typeof fetch}} deps
 * @param {string} id
 * @returns {Promise<any|null>}
 */
async function fetchFx(deps, id) {
  const url = `${ENDPOINT}/${id}`;
  try {
    const res = await deps.fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** One entry of `SOURCES` (see `index.js`). */
export const fxSource = { name: 'fx', fetch: fetchFx };
