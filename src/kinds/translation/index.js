// @ts-check
import { defineKind, notImplemented } from '../defineKind.js';
import { draftTranslation } from './domain.js';
import { fetchTranslationSource } from './source.js';
import { parseTweetId } from '../../sources/url.js';
import { appendFollowUp, persistTranslation } from './persist.js';
import { loadDetails } from './repo.js';
import { present } from './presenter.js';

/**
 * A reply is a candidate follow-up of the tweet it replies to. Whether
 * that tweet is archived, and by the same author, is the caller's check.
 * @param {{replyToId: string|null}} tweet
 */
function followUpOf(tweet) {
  return tweet.replyToId ? { platform: 'x', externalId: tweet.replyToId } : null;
}

export default defineKind({
  name: 'translation',
  table: 'translations',
  urlPrefix: '/t/',
  platform: 'x',
  matchesUrl: parseTweetId,
  fetchSource: fetchTranslationSource,
  followUpOf,
  appendFollowUp,
  draft: draftTranslation,
  persist: persistTranslation,
  loadDetails,
  present,
  search: { textClause: notImplemented('translation.search.textClause'), matchLines: notImplemented('translation.search.matchLines') },
});
