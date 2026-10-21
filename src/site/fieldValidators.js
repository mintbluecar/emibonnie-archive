// @ts-check
import { ROLES } from '../domain/constants.js';
import { contrastRatio, DEFAULT_CARD_COLOUR, DARK_CARD_COLOUR, ALLOWED_REGIONS } from './contrast.js';

const COLOUR_RE = /^#[0-9a-f]{6}$/i;

/**
 * Pushes an error onto `errors` when `value` isn't a non-empty string.
 * @param {string[]} errors
 * @param {string} path
 * @param {unknown} value
 * @returns {boolean}
 */
export function requireString(errors, path, value) {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${path}: required, must be a non-empty string`);
    return false;
  }
  return true;
}

/**
 * @param {string[]} errors
 * @param {string} path
 * @param {unknown} value
 * @returns {string | null}
 */
export function checkColour(errors, path, value) {
  if (typeof value !== 'string' || !COLOUR_RE.test(value)) {
    errors.push(`${path}: must be a #rrggbb colour`);
    return null;
  }
  return value.toLowerCase();
}

/**
 * A featured colour must stay readable against both card colours.
 * @param {string[]} errors
 * @param {string} path
 * @param {string} colour
 */
export function checkColourContrast(errors, path, colour) {
  const vsLight = contrastRatio(colour, DEFAULT_CARD_COLOUR);
  const vsDark = contrastRatio(colour, DARK_CARD_COLOUR);
  if (vsLight < 3) errors.push(`${path}: contrast ${vsLight.toFixed(2)}:1 against the card colour is below 3:1`);
  if (vsDark < 3) errors.push(`${path}: contrast ${vsDark.toFixed(2)}:1 against the dark card colour is below 3:1`);
}

/**
 * @param {string[]} errors
 * @param {any} raw
 * @returns {{ accent: string, rest: string }}
 */
export function checkWordmark(errors, raw) {
  const wordmark = raw.wordmark;
  if (typeof wordmark !== 'object' || wordmark === null) {
    errors.push('wordmark: required, must be an object with accent and rest');
    return { accent: '', rest: '' };
  }
  requireString(errors, 'wordmark.accent', wordmark.accent);
  requireString(errors, 'wordmark.rest', wordmark.rest);
  return {
    accent: typeof wordmark.accent === 'string' ? wordmark.accent : '',
    rest: typeof wordmark.rest === 'string' ? wordmark.rest : '',
  };
}

/**
 * @param {string[]} errors
 * @param {any} raw
 * @returns {string}
 */
export function checkOwnerXUserId(errors, raw) {
  const value = raw.ownerXUserId;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    errors.push('ownerXUserId: required, must be a numeric X user ID string');
    return '';
  }
  return value;
}

/**
 * @param {string[]} errors
 * @param {any} raw
 * @returns {string}
 */
export function checkTimezone(errors, raw) {
  const value = raw.timezone;
  if (typeof value !== 'string' || value.length === 0) {
    errors.push('timezone: required, must be an IANA time zone');
    return '';
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    errors.push(`timezone: '${value}' is not a valid IANA time zone`);
    return '';
  }
  return value;
}

/**
 * @param {string[]} errors
 * @param {any} raw
 * @returns {string}
 */
export function checkRegion(errors, raw) {
  if (raw.region === undefined) return 'sin1';
  if (typeof raw.region !== 'string' || !ALLOWED_REGIONS.includes(raw.region)) {
    errors.push(`region: must be one of the Vercel region codes (${ALLOWED_REGIONS.join(', ')})`);
    return 'sin1';
  }
  return raw.region;
}

/**
 * @param {string[]} errors
 * @param {any} raw
 * @returns {string}
 */
export function checkContactUrl(errors, raw) {
  const value = raw.contactUrl;
  if (typeof value !== 'string' || value.length === 0) {
    errors.push('contactUrl: required, the one public contact link (never a personal email)');
    return '';
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') throw new Error('not https');
  } catch {
    errors.push('contactUrl: must be a valid https URL');
    return '';
  }
  return value;
}

/**
 * @param {string[]} errors
 * @param {any} raw
 * @returns {boolean}
 */
export function checkLowercaseNames(errors, raw) {
  if (raw.lowercaseNames === undefined) return false;
  if (typeof raw.lowercaseNames !== 'boolean') {
    errors.push('lowercaseNames: must be a boolean');
    return false;
  }
  return raw.lowercaseNames;
}

/**
 * @param {string[]} errors
 * @param {string} path
 * @param {unknown} value
 * @param {string[]} fallback
 * @returns {string[]}
 */
export function checkStringArray(errors, path, value, fallback) {
  if (value === undefined) return fallback;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    errors.push(`${path}: must be an array of strings`);
    return fallback;
  }
  return value;
}

/**
 * @param {string[]} errors
 * @param {string} base
 * @param {unknown} igHandle
 * @param {Set<string>} seenHandles
 */
function checkDuplicateHandle(errors, base, igHandle, seenHandles) {
  if (typeof igHandle !== 'string') return;
  if (seenHandles.has(igHandle)) errors.push(`${base}.igHandle: duplicate handle '${igHandle}'`);
  seenHandles.add(igHandle);
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function asStringOr(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

/**
 * @param {string[]} errors
 * @param {any} person
 * @param {number} index
 * @param {Set<string>} seenHandles
 * @returns {{ igHandle: string, displayName: string, emoji: string, colour: string }}
 */
export function checkOneFeaturedPerson(errors, person, index, seenHandles) {
  const base = `featuredPeople[${index}]`;
  const igHandle = person?.igHandle;
  const displayName = person?.displayName;
  const emoji = person?.emoji;
  requireString(errors, `${base}.igHandle`, igHandle);
  requireString(errors, `${base}.displayName`, displayName);
  requireString(errors, `${base}.emoji`, emoji);
  checkDuplicateHandle(errors, base, igHandle, seenHandles);
  const colour = checkColour(errors, `${base}.colour`, person?.colour);
  if (colour) checkColourContrast(errors, `${base}.colour`, colour);
  return {
    igHandle: asStringOr(igHandle, ''),
    displayName: asStringOr(displayName, ''),
    emoji: asStringOr(emoji, ''),
    colour: colour ?? '#000000',
  };
}

/**
 * @param {string[]} errors
 * @param {string} marker
 * @param {any} target
 * @param {Set<string>} handles
 * @returns {{ personHandle: string } | { role: string }}
 */
export function checkOneMarker(errors, marker, target, handles) {
  const path = `defaultMarkers.${marker}`;
  if (target && typeof target === 'object' && typeof target.personHandle === 'string') {
    if (!handles.has(target.personHandle)) {
      errors.push(`${path}: personHandle '${target.personHandle}' is not a featured person`);
    }
    return { personHandle: target.personHandle };
  }
  if (target && typeof target === 'object' && typeof target.role === 'string') {
    if (!ROLES.includes(target.role)) errors.push(`${path}: role '${target.role}' is not in ROLES`);
    return { role: target.role };
  }
  errors.push(`${path}: must be { personHandle } or { role }`);
  return { role: 'speaker' };
}

/**
 * @param {string[]} errors
 * @param {any} pattern
 * @param {number} index
 * @returns {{ code: string, platformCode: string, pattern: string }}
 */
export function checkOneLivePattern(errors, pattern, index) {
  const base = `extraLivePatterns[${index}]`;
  requireString(errors, `${base}.code`, pattern?.code);
  requireString(errors, `${base}.platformCode`, pattern?.platformCode);
  requireString(errors, `${base}.pattern`, pattern?.pattern);
  return {
    code: typeof pattern?.code === 'string' ? pattern.code : '',
    platformCode: typeof pattern?.platformCode === 'string' ? pattern.platformCode : '',
    pattern: typeof pattern?.pattern === 'string' ? pattern.pattern : '',
  };
}
