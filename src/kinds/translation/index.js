// @ts-check
import { defineKind } from '../defineKind.js';
import { draftTranslation } from './domain.js';
import { fetchTranslationSource } from './source.js';
import { parseTweetId } from '../../sources/url.js';
import { appendFollowUp, persistTranslation } from './persist.js';
import { loadDetails } from './repo.js';
import { present } from './presenter.js';
import { search } from './search.js';
import { refreshEdits, checkFollowUps } from './upkeep.js';
import { remapSpeakers } from './remap.js';

/**
 * A reply is a candidate follow-up of the tweet it replies to. Whether
 * that tweet is archived, and by the same author, is the caller's check.
 * @param {{replyToId: string|null}} tweet
 */
function followUpOf(tweet) {
  return tweet.replyToId ? { platform: 'x', externalId: tweet.replyToId } : null;
}

/** @param {string} handle @returns {string} */
function profileUrl(handle) {
  return `https://x.com/${encodeURIComponent(handle)}`;
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
  search,
  refresh: refreshEdits,
  checkFollowUps,
  profileUrl,
  remapSpeakers,
});
