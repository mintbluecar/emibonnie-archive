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
 * The preview card's thumbnail (ThumbVM, Task 10c) from the same media
 * the item page pins: a clip's poster, else the first picture; a quote's
 * own clip or pictures the same way. Null for a text-only quote or a
 * clip with no poster.
 * @param {MediaVM|null} media
 * @returns {import('../../http/contracts.js').ThumbVM|null}
 */
export function thumbOf(media) {
  const shown = media?.type === 'quote' ? media.inner : media;
  if (shown?.type === 'video') return shown.poster ? { url: shown.poster, width: shown.width, height: shown.height, video: true } : null;
  const first = shown?.type === 'images' ? shown.images[0] : undefined;
  return first ? { url: first.url, width: first.width, height: first.height, video: false } : null;
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
