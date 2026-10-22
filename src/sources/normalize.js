// @ts-check

/**
 * @typedef {{bitrate: number, url: string}} VideoVariant
 * @typedef {{variants: VideoVariant[], durationMs: number, width: number, height: number, poster: string|null}} TweetVideo
 *   `poster`: the clip's own still image (pbs.twimg.com only), shown before play.
 * @typedef {{url: string, width: number, height: number}} TweetImage
 * @typedef {{handle: string, url: string}} ClipSource
 * @typedef {{
 *   id: string,
 *   authorId: string|null,
 *   authorHandle: string|null,
 *   authorName: string|null,
 *   text: string,
 *   createdAt: string|null,
 *   images: TweetImage[],
 *   video: TweetVideo|null,
 * }} QuotedTweet
 * @typedef {{id: string, text: string, createdAt: string|null, editableUntil: string|null}} FollowUp
 * @typedef {{versionIds: string[], latestId: string, editableUntil: string|null, isStale: boolean}} TweetEdit
 * @typedef {{
 *   id: string,
 *   status: 'live'|'deleted'|'unavailable',
 *   authorId: string|null,
 *   authorHandle: string|null,
 *   authorName: string|null,
 *   createdAt: string|null,
 *   text: string,
 *   textSource: 'fx'|'syndication'|null,
 *   video: TweetVideo|null,
 *   images: TweetImage[],
 *   quoted: QuotedTweet|null,
 *   clipSource: ClipSource|null,
 *   quotedId: string|null,
 *   replyToId: string|null,
 *   followUps: FollowUp[],
 *   edit: TweetEdit,
 * }} Tweet
 */

const MP4_HOST = 'video.twimg.com';
const IMAGE_HOST = 'pbs.twimg.com';
const CLIP_HOSTS = new Set(['x.com', 'twitter.com']);
const CLIP_HANDLE = /^https:\/\/(?:x|twitter)\.com\/([^/]+)\//u;
const TRAILING_TCO = /\s*https:\/\/t\.co\/\w+\s*$/u;

/** @param {string} url */
function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** @param {string} text */
function withoutTrailingMediaLink(text) {
  return text.replace(TRAILING_TCO, '');
}

/**
 * @param {any} obj
 * @param {string} key
 */
function numberOr(obj, key) {
  return obj?.[key] ?? 0;
}

/**
 * A clip's still, kept only as an https URL on X's image host (fix round
 * 1, M2), the same host CSP's img-src allows.
 * @param {unknown} url @returns {string|null}
 */
function posterOf(url) {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === IMAGE_HOST ? url : null;
  } catch {
    return null;
  }
}

/** @param {any[]|undefined} mediaDetails */
function findVideoDetail(mediaDetails) {
  return (mediaDetails ?? []).find((media) => media.type === 'video') ?? null;
}

/** @param {any} entry */
function mp4VariantsOf(entry) {
  const variants = entry.video_info?.variants ?? [];
  return variants
    .filter((/** @type {any} */ variant) => variant.content_type === 'video/mp4' && hostnameOf(variant.url) === MP4_HOST)
    .map((/** @type {any} */ variant) => ({ bitrate: variant.bitrate, url: variant.url }))
    .sort((/** @type {VideoVariant} */ a, /** @type {VideoVariant} */ b) => a.bitrate - b.bitrate);
}

/**
 * @param {any[]|undefined} mediaDetails
 * @returns {TweetVideo|null}
 */
function videoFrom(mediaDetails) {
  const entry = findVideoDetail(mediaDetails);
  if (!entry) return null;

  return {
    variants: mp4VariantsOf(entry),
    durationMs: numberOr(entry.video_info, 'duration_millis'),
    width: numberOr(entry.original_info, 'width'),
    height: numberOr(entry.original_info, 'height'),
    poster: posterOf(entry.media_url_https),
  };
}

/**
 * @param {any[]|undefined} mediaDetails
 * @returns {TweetImage[]}
 */
function imagesFrom(mediaDetails) {
  return (mediaDetails ?? [])
    .filter((media) => media.type === 'photo' && hostnameOf(media.media_url_https) === IMAGE_HOST)
    .map((media) => ({
      url: media.media_url_https,
      width: media.original_info?.width ?? 0,
      height: media.original_info?.height ?? 0,
    }));
}

/** @param {any} entities */
function clipSourceFrom(entities) {
  const url = entities?.media?.[0]?.expanded_url;
  const host = url ? hostnameOf(url) : null;
  if (!host || !CLIP_HOSTS.has(host)) return null;

  const match = CLIP_HANDLE.exec(url);
  return match ? { handle: match[1], url } : null;
}

/** @param {any} quotedTweet */
function quotedFrom(quotedTweet) {
  if (!quotedTweet) return null;
  return {
    id: quotedTweet.id_str,
    authorId: quotedTweet.user?.id_str ?? null,
    authorHandle: quotedTweet.user?.screen_name ?? null,
    authorName: quotedTweet.user?.name ?? null,
    text: withoutTrailingMediaLink(quotedTweet.text ?? ''),
    createdAt: quotedTweet.created_at ?? null,
    images: imagesFrom(quotedTweet.mediaDetails),
    video: videoFrom(quotedTweet.mediaDetails),
  };
}

/**
 * @param {any} obj
 * @param {string} key
 */
function prop(obj, key) {
  return obj?.[key] ?? null;
}

/**
 * @param {any} primary
 * @param {string} primaryKey
 * @param {any} fallback
 * @param {string} fallbackKey
 */
function fieldOr(primary, primaryKey, fallback, fallbackKey) {
  return prop(primary, primaryKey) ?? prop(fallback, fallbackKey);
}

/** @param {any} syn */
function quotedTweetOf(syn) {
  return prop(syn, 'quoted_tweet');
}

/** @param {any} syn */
function quotedIdOf(syn) {
  return prop(quotedTweetOf(syn), 'id_str');
}

/** @param {any} fxStatus */
function replyToIdOf(fxStatus) {
  return prop(prop(fxStatus, 'replying_to'), 'status');
}

/**
 * @param {any} syn
 * @param {any} fxStatus
 * @returns {{text: string, textSource: 'fx'|'syndication'|null}}
 */
function textFrom(syn, fxStatus) {
  const fxText = fxStatus?.text;
  if ((syn?.note_tweet || !syn) && typeof fxText === 'string') {
    return { text: fxText, textSource: 'fx' };
  }
  if (typeof syn?.text === 'string') {
    return { text: withoutTrailingMediaLink(syn.text), textSource: 'syndication' };
  }
  if (typeof fxText === 'string') {
    return { text: fxText, textSource: 'fx' };
  }
  return { text: '', textSource: null };
}

/** @param {any} value */
function isTombstone(value) {
  return value?.__typename === 'TweetTombstone';
}

/**
 * Reads X's edit window from syndication's `edit_control`/`isStaleEdit`.
 * @param {any} syn
 * @param {string} id
 * @returns {TweetEdit}
 */
function editFrom(syn, id) {
  const ids = syn?.edit_control?.edit_tweet_ids;
  const versionIds = Array.isArray(ids) && ids.length > 0 ? ids : [id];
  const untilMsecs = syn?.edit_control?.editable_until_msecs;
  return {
    versionIds,
    latestId: versionIds[versionIds.length - 1],
    editableUntil: untilMsecs ? new Date(Number(untilMsecs)).toISOString() : null,
    isStale: syn?.isStaleEdit === true,
  };
}

/**
 * @param {string} id
 * @param {'deleted'|'unavailable'} status
 * @returns {Tweet}
 */
function emptyTweet(id, status) {
  return {
    id,
    status,
    authorId: null,
    authorHandle: null,
    authorName: null,
    createdAt: null,
    text: '',
    textSource: null,
    video: null,
    images: [],
    quoted: null,
    clipSource: null,
    quotedId: null,
    replyToId: null,
    followUps: [],
    edit: editFrom(null, id),
  };
}

/**
 * Builds a `Tweet` from the raw syndication and fx responses for one id.
 * Pure: no I/O, no clock.
 * @param {string} id
 * @param {{syndication?: any, fx?: any}} results
 * @returns {Tweet}
 */
export function normalize(id, results) {
  const { syndication: syn, fx } = results;
  if (isTombstone(syn) || isTombstone(fx)) return emptyTweet(id, 'deleted');
  if (!syn && !fx) return emptyTweet(id, 'unavailable');

  const fxStatus = prop(fx, 'status');
  const { text, textSource } = textFrom(syn, fxStatus);
  const user = prop(syn, 'user');
  const fxAuthor = prop(fxStatus, 'author');

  return {
    id,
    status: 'live',
    authorId: fieldOr(user, 'id_str', fxAuthor, 'id'),
    authorHandle: fieldOr(user, 'screen_name', fxAuthor, 'screen_name'),
    authorName: fieldOr(user, 'name', fxAuthor, 'name'),
    createdAt: fieldOr(syn, 'created_at', fxStatus, 'created_at'),
    text,
    textSource,
    video: videoFrom(prop(syn, 'mediaDetails')),
    images: imagesFrom(prop(syn, 'mediaDetails')),
    quoted: quotedFrom(quotedTweetOf(syn)),
    clipSource: clipSourceFrom(prop(syn, 'entities')),
    quotedId: quotedIdOf(syn),
    replyToId: replyToIdOf(fxStatus),
    followUps: [],
    edit: editFrom(syn, id),
  };
}
