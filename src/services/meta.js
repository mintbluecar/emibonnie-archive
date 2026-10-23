// @ts-check
/**
 * Link-preview meta for shared item and event links: the built page HTML
 * (`item.html` / `event.html` in the public dir, else a minimal shell)
 * with `<title>`, `og:title`, `og:description`, `og:image` (the site logo)
 * and `twitter:card` injected. A hidden or missing target gets the site's
 * generic meta, so a preview never reveals that it exists. Every injected
 * value is attribute-escaped. Never names a kind: item pages are found by
 * their kind's `urlPrefix`.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { findVisibleItemId } from '../repo/cards.js';
import { getVisibleEventBySlug } from '../repo/events.js';
import { kindsOf, presenterContext, previewsFor } from './cards.js';

/** @typedef {import('./cards.js').ViewDeps & { pages?: { dir: string, logo: string|null } }} MetaDeps */
/** @typedef {{ title: string, description: string, image: string|null }} Meta */
/**
 * @typedef {{ html: string, found: boolean }} MetaPage
 *   `found`: false when the target is hidden or missing (the generic meta),
 *   so the route can cache it as briefly as a 404.
 */

const DESCRIPTION_MAX = 200;
const SHELL = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title></title>\n</head>\n<body></body>\n</html>\n';
/** A page's own `<title>` elements, removed before injecting. */
const OWN_TITLE = /<title\b[^>]*>[\s\S]*?<\/title\s*>[ \t]*\n?/gi;
/** A page's own `og:*`, `twitter:*` and `description` meta tags, removed before injecting. */
const OWN_META = /<meta\b[^>]*\b(?:property|name)\s*=\s*["']?(?:og:|twitter:|description["'\s>/])[^>]*>[ \t]*\n?/gi;
/** @type {Record<string, string>} */
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** @param {string} text */
export function escapeAttr(text) {
  return text.replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}

/** At most `max` code points, ending in an ellipsis when cut. @param {string} text @param {number} max */
function clip(text, max) {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

/**
 * Puts `meta` into `html` (null: the built-in shell): removes the page's
 * own `<title>`, `og:*`, `twitter:*` and `description` tags, then adds
 * the new ones before `</head>`. Replacement callbacks
 * keep `$&`-style patterns in the page or the values inert.
 * @param {string|null} html @param {Meta} meta @returns {string}
 */
export function injectMeta(html, meta) {
  const page = html ?? SHELL;
  const title = escapeAttr(meta.title);
  const tags = [
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${escapeAttr(meta.description)}">`,
    ...(meta.image ? [`<meta property="og:image" content="${escapeAttr(meta.image)}">`] : []),
    '<meta property="og:type" content="website">',
    '<meta name="twitter:card" content="summary">',
    `<meta name="description" content="${escapeAttr(meta.description)}">`,
  ].join('\n');
  const bare = page.replace(OWN_TITLE, '').replace(OWN_META, '');
  return bare.replace(/<\/head>/i, () => `<title>${title}</title>\n${tags}\n</head>`);
}

/** @param {MetaDeps} deps @param {string} name @returns {Promise<string|null>} */
async function readPage(deps, name) {
  if (!deps.pages) return null;
  try {
    return await readFile(path.join(deps.pages.dir, name), 'utf8');
  } catch {
    return null;
  }
}

/** @param {MetaDeps} deps @param {string} origin @param {string} title @param {string} [description] @returns {Meta} */
function metaOf(deps, origin, title, description) {
  const image = deps.pages?.logo ? `${origin}${deps.pages.logo}` : null;
  return { title, description: clip(description ?? deps.site.tagline, DESCRIPTION_MAX), image };
}

/** @param {MetaDeps} deps @param {string} name */
const titled = (deps, name) => `${name} · ${deps.site.name}`;

/**
 * @param {MetaDeps} deps
 * @param {{ prefix: string, sourceId: string, origin: string }} target the item URL's prefix (`t` for `/t/…`)
 * @returns {Promise<MetaPage>}
 */
export async function itemMetaPage(deps, { prefix, sourceId, origin }) {
  const kind = Object.values(kindsOf(deps)).find((k) => k.urlPrefix === `/${prefix}/`);
  const id = kind ? await findVisibleItemId(deps.db, { kind: kind.name, platform: kind.platform, externalId: sourceId }) : null;
  const [entry] = id === null ? [] : await previewsFor(deps, [id], await presenterContext(deps));
  const html = await readPage(deps, 'item.html');
  if (!entry) return { html: injectMeta(html, metaOf(deps, origin, deps.site.name)), found: false };
  const line = entry.preview.lines.find((l) => 'text' in l && l.text.trim() !== '');
  const title = entry.card.event ? titled(deps, entry.card.event.name) : deps.site.name;
  return { html: injectMeta(html, metaOf(deps, origin, title, line && 'text' in line ? line.text : undefined)), found: true };
}

/**
 * @param {MetaDeps} deps
 * @param {{ slug: string, origin: string }} target
 * @returns {Promise<MetaPage>}
 */
export async function eventMetaPage(deps, { slug, origin }) {
  const event = await getVisibleEventBySlug(deps.db, slug);
  const html = await readPage(deps, 'event.html');
  if (!event) return { html: injectMeta(html, metaOf(deps, origin, deps.site.name)), found: false };
  const description = [event.occurredOn, ...(event.hashtags[0] ? [`#${event.hashtags[0]}`] : [])].join(' · ');
  return { html: injectMeta(html, metaOf(deps, origin, titled(deps, event.name), description)), found: true };
}
