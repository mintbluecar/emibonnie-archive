// @ts-check
import { defineKind, notImplemented } from '../defineKind.js';
import { draftTranslation } from './domain.js';
import { fetchTweet } from '../../sources/fetchTweet.js';
import { parseTweetId } from '../../sources/url.js';

/**
 * A reply is a candidate follow-up of the tweet it replies to. Whether
 * that tweet is archived, and by the same author, is the caller's check.
 * @param {{replyToId: string|null}} tweet
 */
function followUpOf(tweet) {
  return tweet.replyToId ? { platform: 'x', externalId: tweet.replyToId } : null;
}

/** @param {string} what */
function notImplementedAsync(what) {
  const fail = notImplemented(what);
  return async () => fail();
}

export default defineKind({
  name: 'translation',
  table: 'translations',
  urlPrefix: '/t/',
  matchesUrl: parseTweetId,
  fetchSource: fetchTweet,
  followUpOf,
  draft: draftTranslation,
  persist: notImplementedAsync('translation.persist'),
  loadDetails: notImplementedAsync('translation.loadDetails'),
  present: { preview: notImplemented('translation.present.preview'), detail: notImplemented('translation.present.detail') },
  search: { textClause: notImplemented('translation.search.textClause'), matchLines: notImplemented('translation.search.matchLines') },
});
