// @ts-check
import {
  requireString,
  checkWordmark,
  checkOwnerXUserId,
  checkTimezone,
  checkRegion,
  checkContactUrl,
  checkLowercaseNames,
  checkOptionalBoolean,
  checkStringArray,
  checkOneFeaturedPerson,
  checkOneMarker,
  checkOneLivePattern,
} from './fieldValidators.js';
import { checkOneFont } from './fontValidators.js';

export { contrastRatio, DEFAULT_CARD_COLOUR, DARK_CARD_COLOUR } from './contrast.js';
export { ALLOWED_REGIONS } from './regions.js';

/** @typedef {{ platform: string, handle: string }} OtherAccount */
/**
 * @typedef {{ igHandle: string, displayName: string, emoji: string, colour: string,
 *   otherAccounts: OtherAccount[] }} FeaturedPerson
 */
/** @typedef {{ code: string, platformCode: string, pattern: string }} LivePattern */
/** @typedef {{ path: string, weight: number, style: 'normal'|'italic', unicodeRange?: string }} SiteFontFile */
/**
 * A site's own self-hosted font (spec "2b. Fonts a site can choose"):
 * a family and weights, shipped either from an `@fontsource/*` package
 * (`subsets` picked the same way the engine's own `FONT_SPECS` are) or
 * from the site's own `site/fonts/*.woff2` files (`path` relative to
 * `site/fonts/`). Only shipped by the build if some token in
 * `tokens.css` or the site's `theme.css` actually names the family.
 * @typedef {{ family: string, style: 'normal'|'italic', weights: number[] } & (
 *   { package: string, subsets: string[] } | { files: SiteFontFile[] }
 * )} SiteFont
 */
/**
 * @typedef {{ name: string, wordmark: { accent: string, rest: string }, tagline: string, ownerXUserId: string,
 *   sourceLanguage: string, timezone: string, region: string, lowercaseNames: boolean, featuredPeople: FeaturedPerson[],
 *   defaultMarkers: Record<string, { personHandle: string } | { role: string }>, ignoredHashtags: string[],
 *   categories: string[], extraLivePatterns: LivePattern[], contactUrl: string, embedSources: boolean,
 *   roleEmoji: Record<string, string>, favicon: string|null, fonts: SiteFont[] }} Site
 */

const DEFAULT_CATEGORIES = ['show / interview', 'fan meet / fan day', 'live'];

/**
 * The plain required-string fields with no normalisation of their own.
 * @param {string[]} errors
 * @param {any} input
 */
function checkRequiredStrings(errors, input) {
  requireString(errors, 'name', input.name);
  requireString(errors, 'tagline', input.tagline);
  requireString(errors, 'sourceLanguage', input.sourceLanguage);
}

/**
 * @param {{ errors: string[], warnings: string[] }} report
 * @param {any} raw
 * @returns {FeaturedPerson[]}
 */
function checkFeaturedPeople(report, raw) {
  const list = raw.featuredPeople;
  if (!Array.isArray(list) || list.length === 0) {
    report.errors.push('featuredPeople: required, must be a non-empty array');
    return [];
  }
  const seenHandles = new Set();
  return list.map((person, index) => checkOneFeaturedPerson(report, person, index, seenHandles));
}

/**
 * @param {string[]} errors
 * @param {any} raw
 * @param {FeaturedPerson[]} featuredPeople
 * @returns {Record<string, { personHandle: string } | { role: string }>}
 */
function checkDefaultMarkers(errors, raw, featuredPeople) {
  const markers = raw.defaultMarkers;
  if (markers === undefined) return {};
  if (typeof markers !== 'object' || markers === null) {
    errors.push('defaultMarkers: must be an object mapping a marker to a person or role');
    return {};
  }
  const handles = new Set(featuredPeople.map((person) => person.igHandle));
  /** @type {Record<string, { personHandle: string } | { role: string }>} */
  const result = {};
  for (const [marker, target] of Object.entries(markers)) {
    result[marker] = checkOneMarker(errors, marker, target, handles);
  }
  return result;
}

/**
 * @param {string[]} errors
 * @param {any} raw
 * @returns {LivePattern[]}
 */
function checkExtraLivePatterns(errors, raw) {
  const value = raw.extraLivePatterns;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push('extraLivePatterns: must be an array');
    return [];
  }
  return value.map((pattern, index) => checkOneLivePattern(errors, pattern, index));
}

/** The roles a site may give a default emoji (crowd shows as a note, with none). */
const EMOJI_ROLES = ['fan', 'host', 'speaker'];

/**
 * `roleEmoji` (optional): overrides `ROLE_EMOJI` (src/domain/constants.js)
 * for some of fan, host, speaker; each value a non-empty string.
 * @param {string[]} errors
 * @param {any} raw
 * @returns {Record<string, string>}
 */
function checkRoleEmoji(errors, raw) {
  const value = raw.roleEmoji;
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push('roleEmoji: must be an object mapping fan, host or speaker to an emoji');
    return {};
  }
  /** @type {Record<string, string>} */
  const result = {};
  for (const [role, emoji] of Object.entries(value)) {
    if (!EMOJI_ROLES.includes(role)) errors.push(`roleEmoji.${role}: must be one of ${EMOJI_ROLES.join(', ')}`);
    else if (typeof emoji !== 'string' || emoji.trim() === '') errors.push(`roleEmoji.${role}: must be a non-empty string`);
    else result[role] = emoji;
  }
  return result;
}

/**
 * `favicon` (optional, Task 10c): a .png or .svg file inside the site
 * folder, as a relative path (no leading '/', no '..'); the build checks
 * it exists. Without it the favicon is the site's logo.
 * @param {string[]} errors
 * @param {any} raw
 * @returns {string|null}
 */
function checkFavicon(errors, raw) {
  const value = raw.favicon;
  if (value === undefined) return null;
  const ok = typeof value === 'string' && /^[\w./-]+\.(png|svg)$/i.test(value) && !value.startsWith('/') && !value.split('/').includes('..');
  if (!ok) {
    errors.push('favicon: must be a relative path to a .png or .svg file inside the site folder (e.g. "favicon.png")');
    return null;
  }
  return value;
}

/**
 * `fonts` (optional, default `[]`; spec "2b. Fonts a site can choose"):
 * the site's own self-hosted font families. Which of them the build
 * actually ships -- only the ones some token in `tokens.css` or
 * `theme.css` names -- is decided at build time
 * (`scripts/buildAssets.js`'s `buildFontsCss`), not here.
 * @param {string[]} errors
 * @param {any} raw
 * @returns {SiteFont[]}
 */
function checkFonts(errors, raw) {
  const value = raw.fonts;
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push('fonts: must be an array');
    return [];
  }
  return value.map((font, index) => checkOneFont(errors, font, index));
}

/**
 * Validates and normalises a site's raw `site.json`. Every error names the
 * field path it came from. `warnings` (e.g. a featured colour that's a bit
 * low-contrast against a card -- review round 2, fix round 2, item 2: the
 * engine no longer puts that raw colour in text itself, so this never
 * fails the build) never block a valid site.
 * @param {unknown} raw
 * @returns {{ ok: true, site: Site, warnings: string[] } | { ok: false, errors: string[], warnings: string[] }}
 */
export function validateSite(raw) {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['site: must be an object'], warnings: [] };
  }

  /** @type {any} */
  const input = raw;
  /** @type {{ errors: string[], warnings: string[] }} */
  const report = { errors: [], warnings: [] };
  const { errors, warnings } = report;

  checkRequiredStrings(errors, input);
  const wordmark = checkWordmark(errors, input);
  const ownerXUserId = checkOwnerXUserId(errors, input);
  const timezone = checkTimezone(errors, input);
  const region = checkRegion(errors, input);
  const lowercaseNames = checkLowercaseNames(errors, input);
  const featuredPeople = checkFeaturedPeople(report, input);
  const defaultMarkers = checkDefaultMarkers(errors, input, featuredPeople);
  const ignoredHashtags = checkStringArray(errors, 'ignoredHashtags', input.ignoredHashtags, []);
  const categories = checkStringArray(errors, 'categories', input.categories, DEFAULT_CATEGORIES);
  const extraLivePatterns = checkExtraLivePatterns(errors, input);
  const contactUrl = checkContactUrl(errors, input);
  const embedSources = checkOptionalBoolean(errors, input, 'embedSources');
  const roleEmoji = checkRoleEmoji(errors, input);
  const favicon = checkFavicon(errors, input);
  const fonts = checkFonts(errors, input);

  if (errors.length > 0) return { ok: false, errors, warnings };

  return {
    ok: true,
    warnings,
    site: {
      name: input.name,
      wordmark,
      tagline: input.tagline,
      ownerXUserId,
      sourceLanguage: input.sourceLanguage,
      timezone,
      region,
      lowercaseNames,
      featuredPeople,
      defaultMarkers,
      ignoredHashtags,
      categories,
      extraLivePatterns,
      contactUrl,
      embedSources,
      roleEmoji,
      favicon,
      fonts,
    },
  };
}
