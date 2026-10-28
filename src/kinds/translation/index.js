// @ts-check
import { defineKind } from '../defineKind.js';
import { draftTranslation } from './domain.js';
import { fetchTranslationSource } from './source.js';
import { parseTweetId } from '../../sources/url.js';
import { appendFollowUp, persistTranslation } from './persist.js';
import { heldItemIds, loadDetails, reviewHeld, setLineFixes } from './repo.js';
import { present } from './presenter.js';
import { search } from './search.js';
import { refreshEdits, checkFollowUps } from './upkeep.js';
import { remapSpeakers } from './remap.js';
import { profileUrl } from './profile.js';
import { draftMedia } from './media.js';

/**
 * A reply is a candidate follow-up of the tweet it replies to. Whether
 * that tweet is archived, and by the same author, is the caller's check.
 * @param {{replyToId: string|null}} tweet
 */
function followUpOf(tweet) {
  return tweet.replyToId ? { platform: 'x', externalId: tweet.replyToId } : null;
}

/** @param {import('../../db/common.js').Tx} tx @param {{ itemId: number, subbed: boolean }} args */
async function setSubbed(tx, { itemId, subbed }) {
  await tx.query('update translations set subbed = $2 where item_id = $1', [itemId, subbed]);
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
  previewDraft: (/** @type {any} */ draft) => ({ media: draftMedia(draft.tweet) }),
  profileUrl,
  remapSpeakers,
  setLineFixes: (/** @type {any} */ tx, /** @type {any} */ { itemId, fixes }) => setLineFixes(tx, itemId, fixes),
  setSubbed,
  heldItemIds,
  reviewHeld,
});
