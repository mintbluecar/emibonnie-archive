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

/** @param {any} video @returns {VideoVM|null} */
function videoOf(video) {
  if (!video || !Array.isArray(video.variants) || video.variants.length === 0) return null;
  return { type: 'video', variants: video.variants, width: video.width, height: video.height };
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
