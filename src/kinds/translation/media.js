// @ts-check
/**
 * Which media a translation's pinned area shows (MediaVM in
 * src/http/contracts.js), from its archived sources: the translator's own
 * clip, else their own pictures, else the quoted post. A clip or pictures
 * only while their source is live; the quote card always, since its text
 * is archived (its pictures or clip only while the quoted post is live).
 */

/** @typedef {import('../../http/contracts.js').MediaVM} MediaVM */
/** @typedef {import('../../http/contracts.js').VideoVM} VideoVM */
/** @typedef {import('../../http/contracts.js').ImagesVM} ImagesVM */
/** @typedef {Record<string, any>} SourceRow */

/**
 * The sources public output may show: every source whose account opted
 * out is dropped (its clip, pictures or quoted post with it), whatever its
 * role. The one place the translation kind redacts opted-out accounts.
 * @param {SourceRow[]} sources
 * @returns {SourceRow[]}
 */
export function publicSources(sources) {
  return sources.filter((s) => s.accountOptedOut !== true);
}

/** @param {any} video @returns {VideoVM|null} */
function videoOf(video) {
  if (!video || !Array.isArray(video.variants) || video.variants.length === 0) return null;
  const poster = typeof video.poster === 'string' ? video.poster : null;
  return { type: 'video', variants: video.variants, width: video.width, height: video.height, poster };
}

/** @param {any} images @returns {ImagesVM|null} */
function imagesOf(images) {
  if (!Array.isArray(images) || images.length === 0) return null;
  return { type: 'images', images: images.map((/** @type {any} */ i) => ({ url: i.url, width: i.width, height: i.height })) };
}

/** @param {SourceRow} source */
const isLive = (source) => source.status === 'live';

/** @param {SourceRow[]} sources @param {string} role */
function withRole(sources, role) {
  return sources.filter((s) => s.role === role && s.media);
}

/** @param {SourceRow} quoted @returns {MediaVM} */
function quoteOf(quoted) {
  const m = quoted.media;
  const inner = isLive(quoted) ? (videoOf(m.video) ?? imagesOf(m.images)) : null;
  return {
    type: 'quote', authorName: m.authorName ?? null, authorHandle: m.authorHandle ?? null, text: m.text ?? '',
    postedAt: m.createdAt ?? null, inner,
  };
}

/**
 * @param {SourceRow[]} sources
 * @returns {MediaVM|null}
 */
export function resolveMedia(sources) {
  const own = withRole(sources, 'media').filter(isLive);
  const video = own.map((s) => videoOf(s.media)).find(Boolean);
  if (video) return video;
  const images = own.map((s) => imagesOf(s.media.images)).find(Boolean);
  if (images) return images;
  const [quoted] = withRole(sources, 'quoted');
  return quoted ? quoteOf(quoted) : null;
}

/**
 * The media a *not yet archived* post would pin, from its fetched tweet
 * (Task 13's add form): `resolveMedia` reads source rows, and a draft has
 * none yet. A fresh fetch is live, so the same rules apply; the quoted
 * post is always shown, as it is for a saved item.
 * @param {import('../../sources/normalize.js').Tweet} tweet
 * @returns {MediaVM|null}
 */
export function draftMedia(tweet) {
  /** @type {SourceRow[]} */
  const sources = [];
  const video = tweet.video && tweet.video.variants.length > 0 ? tweet.video : null;
  if (video || tweet.images.length > 0) {
    sources.push({
      role: 'media', status: 'live', accountHandle: tweet.clipSource?.handle ?? null,
      media: video ? { ...video } : { images: tweet.images },
    });
  }
  if (tweet.quoted) {
    const { text, authorHandle, authorName, createdAt, images, video: quotedVideo } = tweet.quoted;
    sources.push({ role: 'quoted', status: 'live', media: { text, authorHandle, authorName, createdAt, images, video: quotedVideo } });
  }
  return resolveMedia(sources);
}

/** Only X's image host (the same guard as videoPlayer.js's `POSTER_URL`, and CSP's img-src). */
const THUMB_URL = /^https:\/\/pbs\.twimg\.com\//;

/**
 * @param {string|null} url @param {{ width: number, height: number }} size @param {boolean} video
 * @returns {import('../../http/contracts.js').ThumbVM|null}
 */
function thumbAt(url, { width, height }, video) {
  return url && THUMB_URL.test(url) ? { url, width, height, video } : null;
}

/**
 * The preview card's thumbnail (ThumbVM, Task 10c) from the same media
 * the item page pins: a clip's poster, else the first picture; a quote's
 * own clip or pictures the same way. Null for a text-only quote, a
 * clip with no poster, or a picture not on pbs.twimg.com over https.
 * @param {MediaVM|null} media
 * @returns {import('../../http/contracts.js').ThumbVM|null}
 */
export function thumbOf(media) {
  const shown = media?.type === 'quote' ? media.inner : media;
  if (shown?.type === 'video') return thumbAt(shown.poster, shown, true);
  const first = shown?.type === 'images' ? shown.images[0] : undefined;
  return first ? thumbAt(first.url, first, false) : null;
}

/** @param {MediaVM|null} media */
export function hasVideo(media) {
  return media?.type === 'video' || (media?.type === 'quote' && media.inner?.type === 'video');
}

/**
 * The account a clip or pictures are credited to, when it isn't the translator.
 * @param {SourceRow[]} sources
 * @param {string|null} translatorHandle
 */
export function clipByOf(sources, translatorHandle) {
  const handle = withRole(sources, 'media')[0]?.accountHandle ?? null;
  return handle && handle.toLowerCase() !== translatorHandle?.toLowerCase() ? handle : null;
}
