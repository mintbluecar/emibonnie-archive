// @ts-check
/**
 * The import's fetch guard (Plan 3): a 429 or a 5xx from X or FxTwitter is
 * retried after 1s, 2s and 4s before the row is given up as failed. Lives
 * beside the CLI's own run rather than in the source adapters, so `/add`
 * keeps its single, fast attempt.
 */

/** The waits between attempts; after the last one the response is returned as-is. */
export const RETRY_DELAYS_MS = Object.freeze([1000, 2000, 4000]);

/** @param {number} status */
function isRetryable(status) {
  return status === 429 || status >= 500;
}

/**
 * Wraps a `fetch` so a rate-limited or server-errored response is tried
 * again with the planned backoff. Network errors and other statuses pass
 * through unchanged (the adapters already treat them as "no data").
 * @param {typeof fetch} fetchImpl
 * @param {{ sleep?: (ms: number) => Promise<void>, delays?: readonly number[] }} [options]
 * @returns {typeof fetch}
 */
export function retryingFetch(fetchImpl, { sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }), delays = RETRY_DELAYS_MS } = {}) {
  return /** @type {typeof fetch} */ (async (/** @type {any} */ url, /** @type {any} */ init) => {
    let response = await fetchImpl(url, init);
    for (const delay of delays) {
      if (!isRetryable(response.status)) return response;
      await sleep(delay);
      response = await fetchImpl(url, init);
    }
    return response;
  });
}
