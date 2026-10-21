// @ts-check
/**
 * The translation kind's source fetch. A follow-up's text is taken from
 * its own post fetch (`fetchTweet`), the same path `refreshEdits` re-reads
 * it through, so the thread endpoint's slightly different rendering of a
 * text can never show up later as an "edit". When a follow-up's own fetch
 * isn't live, the thread's text is kept.
 */
import { fetchTweet } from '../../sources/fetchTweet.js';

/** @typedef {import('../../sources/normalize.js').FollowUp} FollowUp */
/** @typedef {FollowUp & { versionIds?: string[] }} FetchedPost */

/**
 * @param {{ fetchImpl: typeof fetch }} deps
 * @param {FollowUp} post
 * @returns {Promise<FetchedPost>}
 */
export async function asFetched(deps, post) {
  const own = await fetchTweet(deps, post.id);
  if (own.status !== 'live') return post;
  return { ...post, text: own.text, editableUntil: own.edit.editableUntil ?? post.editableUntil, versionIds: own.edit.versionIds };
}

/**
 * @param {{ fetchImpl: typeof fetch }} deps
 * @param {string} id
 * @returns {Promise<import('../../sources/normalize.js').Tweet>}
 */
export async function fetchTranslationSource(deps, id) {
  const tweet = await fetchTweet(deps, id);
  if (tweet.status !== 'live' || tweet.followUps.length === 0) return tweet;
  return { ...tweet, followUps: await Promise.all(tweet.followUps.map((post) => asFetched(deps, post))) };
}
