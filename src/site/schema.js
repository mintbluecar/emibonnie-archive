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

export { contrastRatio, DEFAULT_CARD_COLOUR, DARK_CARD_COLOUR } from './contrast.js';
export { ALLOWED_REGIONS } from './regions.js';

/** @typedef {{ platform: string, handle: string }} OtherAccount */
/**
 * @typedef {{ igHandle: string, displayName: string, emoji: string, colour: string,
 *   otherAccounts: OtherAccount[] }} FeaturedPerson
 */
/** @typedef {{ code: string, platformCode: string, pattern: string }} LivePattern */
/**
 * @typedef {{ name: string, wordmark: { accent: string, rest: string }, tagline: string, ownerXUserId: string,
 *   sourceLanguage: string, timezone: string, region: string, lowercaseNames: boolean, featuredPeople: FeaturedPerson[],
 *   defaultMarkers: Record<string, { personHandle: string } | { role: string }>, ignoredHashtags: string[],
 *   categories: string[], extraLivePatterns: LivePattern[], contactUrl: string, embedSources: boolean }} Site
 */

const DEFAULT_CATEGORIES = ['show / interview', 'fan meet / fan day', 'live'];

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

  requireString(errors, 'name', input.name);
  const wordmark = checkWordmark(errors, input);
  requireString(errors, 'tagline', input.tagline);
  const ownerXUserId = checkOwnerXUserId(errors, input);
  requireString(errors, 'sourceLanguage', input.sourceLanguage);
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
    },
  };
}
