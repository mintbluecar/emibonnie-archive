// @ts-check
import { BadRequest } from './errors.js';
import { normalize } from './normalize.js';
import { SOURCES } from './index.js';
import { fetchThread } from './thread.js';

const ID_PATTERN = /^\d{1,20}$/u;

/**
 * Queries every source in `SOURCES` in parallel for `id` and normalizes
 * the results, adding `followUps` from `fetchThread` when live.
 * @param {{fetchImpl: typeof fetch}} deps
 * @param {string} id
 * @returns {Promise<import('./normalize.js').Tweet>}
 */
async function fetchOnce(deps, id) {
  const entries = await Promise.all(SOURCES.map(async (source) => [source.name, await source.fetch(deps, id)]));
  const tweet = normalize(id, Object.fromEntries(entries));
  const followUps = tweet.status === 'live' ? await fetchThread(deps, id) : [];
  return { ...tweet, followUps };
}

/**
 * Validates `id`, then fetches its tweet. When the result is a stale
 * edit, refetches `edit.latestId` once (never looping) and returns that
 * version, keeping the original's full `edit.versionIds`.
 * @param {{fetchImpl: typeof fetch}} deps
 * @param {string} id
 * @returns {Promise<import('./normalize.js').Tweet>}
 */
export async function fetchTweet(deps, id) {
  if (!ID_PATTERN.test(id)) throw new BadRequest(`invalid tweet id: ${id}`);

  const tweet = await fetchOnce(deps, id);
  if (!tweet.edit.isStale || tweet.edit.latestId === id) return tweet;

  const latest = await fetchOnce(deps, tweet.edit.latestId);
  return { ...latest, edit: { ...latest.edit, versionIds: tweet.edit.versionIds } };
}
