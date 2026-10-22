// @ts-check
/**
 * Writes a translation draft's kind-specific rows, inside the caller's
 * transaction: the translation and its parts, the speakers, the item's
 * tags, every source (primary, follow-ups, media, quoted), the
 * follows-on link and the credited account's speaker memory.
 */
import { addSources, findSourceOwner, nextPosition } from '../../repo/itemSources.js';
import { addAliases } from '../../repo/sourceEdits.js';
import { upsertAccount } from '../../repo/accounts.js';
import { tagItem } from '../../repo/tags.js';
import { link } from '../../repo/itemLinks.js';
import { remember } from '../../repo/speakerMemory.js';
import { addParts, insertTranslation, setSpeakers } from './repo.js';

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */
/** @typedef {import('./domain.js').TranslationDraft} TranslationDraft */
/** @typedef {import('../../sources/normalize.js').Tweet} Tweet */
/**
 * @typedef {{ id: string, text: string, editableUntil: string|null, versionIds?: string[] }} PostPart
 *   `versionIds`: every id the post has had (an edited post's earlier
 *   versions); each becomes an alias of its source, as does `id`.
 */

const KIND = 'translation';
const STATUS_ID = /\/status\/(\d{1,20})/u;

/** @param {string|null} handle @param {string} id */
export function statusUrl(handle, id) {
  return `https://x.com/${handle ?? 'i'}/status/${id}`;
}

/**
 * Appends posts to an item as `follow_up` sources (each with its edit
 * window and an alias row) and as parts linked to them, after whatever
 * the item already has. Used at intake, by attaching a pasted follow-up
 * and by the "check for follow-ups" button.
 * @param {Tx} tx
 * @param {{ itemId: number, accountId: number|null, handle: string|null, posts: PostPart[] }} input
 * @returns {Promise<number>} how many were appended
 */
export async function appendPosts(tx, { itemId, accountId, handle, posts }) {
  let position = await nextPosition(tx, itemId, 'follow_up');
  for (const post of posts) {
    const [sourceId] = await addSources(tx, itemId, KIND, [{
      platform: 'x', externalId: post.id, url: statusUrl(handle, post.id), role: 'follow_up', position,
      accountId: accountId ?? undefined, editableUntil: post.editableUntil,
    }]);
    await addAliases(tx, { sourceId, platform: 'x', ids: [post.id, ...(post.versionIds ?? [])] });
    await addParts(tx, itemId, [{ sourceId, body: post.text }]);
    position += 1;
  }
  return posts.length;
}

/**
 * @param {Tx} tx
 * @param {{ itemId: number, accountId: number, draft: TranslationDraft }} input
 * @returns {Promise<void>}
 */
async function addMainPost(tx, { itemId, accountId, draft }) {
  const { tweet, common } = draft;
  const [sourceId] = await addSources(tx, itemId, KIND, [{
    platform: 'x', externalId: tweet.id, url: common.primary.url, role: 'primary', accountId, editableUntil: tweet.edit.editableUntil,
  }]);
  await addAliases(tx, { sourceId, platform: 'x', ids: tweet.edit.versionIds });
  await addParts(tx, itemId, [{ sourceId, body: draft.text }]);
}

/**
 * The account a clip or picture is credited to: the clipper named in the
 * media link, or the translator when it's their own upload. The clipper is
 * known only by handle, so only a handle-only account is matched (else one
 * is added): never an account that merely held that handle before.
 * @param {Tx} tx
 * @param {{ tweet: Tweet, accountId: number }} input
 */
async function mediaAccountOf(tx, { tweet, accountId }) {
  const handle = tweet.clipSource?.handle;
  if (!handle || handle.toLowerCase() === tweet.authorHandle?.toLowerCase()) return accountId;
  return upsertAccount(tx, { platform: 'x', handle });
}

/**
 * @param {Tx} tx
 * @param {{ itemId: number, accountId: number, tweet: Tweet }} input
 * @returns {Promise<void>}
 */
async function addMedia(tx, { itemId, accountId, tweet }) {
  const video = tweet.video && tweet.video.variants.length > 0 ? tweet.video : null;
  if (!video && tweet.images.length === 0) return;
  const url = tweet.clipSource?.url ?? statusUrl(tweet.authorHandle, tweet.id);
  const media = video ? { ...video } : { images: tweet.images };
  await addSources(tx, itemId, KIND, [{
    platform: 'x', externalId: STATUS_ID.exec(url)?.[1] ?? tweet.id, url, role: 'media',
    accountId: await mediaAccountOf(tx, { tweet, accountId }), media,
  }]);
}

/**
 * The quoted original, with its text and pictures/clip copied into
 * `media` so it survives the original's deletion.
 * @param {Tx} tx
 * @param {{ itemId: number, tweet: Tweet }} input
 * @returns {Promise<void>}
 */
async function addQuoted(tx, { itemId, tweet }) {
  const quoted = tweet.quoted;
  if (!quoted) return;
  const accountId = quoted.authorId && quoted.authorHandle
    ? await upsertAccount(tx, { platform: 'x', externalId: quoted.authorId, handle: quoted.authorHandle, displayName: quoted.authorName ?? undefined })
    : undefined;
  const { text, authorHandle, authorName, createdAt, images, video } = quoted;
  await addSources(tx, itemId, KIND, [{
    platform: 'x', externalId: quoted.id, url: statusUrl(authorHandle, quoted.id), role: 'quoted', accountId,
    media: { text, authorHandle, authorName, createdAt, images, video },
  }]);
}

/**
 * The speakers this item actually uses.
 * @param {TranslationDraft} draft
 */
function usedSpeakers(draft) {
  return Object.fromEntries(draft.markers.filter(({ marker }) => draft.speakers[marker]).map(({ marker }) => [marker, draft.speakers[marker]]));
}

/** @param {TranslationDraft} draft */
function tagsOf(draft) {
  const { keyword, tags } = draft.header;
  return [
    ...(keyword ? [{ kind: /** @type {const} */ ('keyword'), display: keyword }] : []),
    ...tags.map((display) => ({ kind: /** @type {const} */ ('hashtag'), display })),
  ];
}

/**
 * @param {Tx} tx
 * @param {{ itemId: number, followsOn: import('../defineKind.js').SourceRef|null }} input
 */
async function linkFollowsOn(tx, { itemId, followsOn }) {
  if (!followsOn) return;
  const owner = await findSourceOwner(tx, { kind: KIND, ...followsOn, roles: ['primary'] });
  if (owner && owner.itemId !== itemId) await link(tx, itemId, owner.itemId, 'follows_on');
}

/**
 * `translation.persist`: `meta` carries the new item's id and the
 * credited account's id.
 * @param {Tx} tx
 * @param {TranslationDraft} draft
 * @param {{ itemId: number, accountId: number }} meta
 * @returns {Promise<number>} the item id
 */
export async function persistTranslation(tx, draft, { itemId, accountId }) {
  const { tweet, common } = draft;
  await insertTranslation(tx, itemId, { textEnteredManually: common.textEnteredManually });
  await addMainPost(tx, { itemId, accountId, draft });
  await appendPosts(tx, { itemId, accountId, handle: tweet.authorHandle, posts: tweet.followUps });
  await addMedia(tx, { itemId, accountId, tweet });
  await addQuoted(tx, { itemId, tweet });
  await setSpeakers(tx, itemId, usedSpeakers(draft));
  await tagItem(tx, itemId, tagsOf(draft));
  await linkFollowsOn(tx, { itemId, followsOn: common.followsOn });
  await remember(tx, accountId, draft.memory);
  return itemId;
}

/**
 * `translation.appendFollowUp`: attaches a pasted same-author reply to the
 * item it continues, as its next part.
 * @param {Tx} tx
 * @param {{ itemId: number, accountId: number|null, input: Tweet }} args
 * @returns {Promise<void>}
 */
export async function appendFollowUp(tx, { itemId, accountId, input }) {
  const post = { id: input.id, text: input.text, editableUntil: input.edit.editableUntil, versionIds: input.edit.versionIds };
  await appendPosts(tx, { itemId, accountId, handle: input.authorHandle, posts: [post] });
}
