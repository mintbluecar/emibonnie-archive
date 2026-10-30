// @ts-check
/**
 * `fonts[]` validators for `site.json` (spec "2b. Fonts a site can
 * choose"): a separate file from `fieldValidators.js` the same way
 * `contrast.js`/`regions.js` already are -- one concern each, imported
 * by `schema.js`.
 */
import { requireString } from './fieldValidators.js';

const FONT_WEIGHT_MIN = 100;
const FONT_WEIGHT_MAX = 900;

/**
 * @param {string[]} errors
 * @param {string} path
 * @param {unknown} value
 * @returns {'normal' | 'italic'}
 */
function checkFontStyle(errors, path, value) {
  if (value === undefined) return 'normal';
  if (value === 'normal' || value === 'italic') return value;
  errors.push(`${path}: must be 'normal' or 'italic'`);
  return 'normal';
}

/**
 * @param {string[]} errors
 * @param {string} path
 * @param {unknown} value
 * @returns {number}
 */
function checkFontWeight(errors, path, value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < FONT_WEIGHT_MIN || value > FONT_WEIGHT_MAX) {
    errors.push(`${path}: must be an integer weight between ${FONT_WEIGHT_MIN} and ${FONT_WEIGHT_MAX}`);
    return 400;
  }
  return value;
}

/**
 * The weights an `@fontsource/*` package font asks the build to ship
 * (docs/site-settings.md, "Fonts"): required, non-empty, each 100-900.
 * @param {string[]} errors
 * @param {string} path
 * @param {unknown} value
 * @returns {number[]}
 */
function checkFontWeights(errors, path, value) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path}: must be a non-empty array of weights`);
    return [];
  }
  return value.map((weight, index) => checkFontWeight(errors, `${path}[${index}]`, weight));
}

/**
 * @param {string[]} errors
 * @param {string} path
 * @param {unknown} value
 * @returns {string[]}
 */
function checkFontSubsets(errors, path, value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((subset) => typeof subset !== 'string' || subset.length === 0)) {
    errors.push(`${path}: must be a non-empty array of subset names`);
    return [];
  }
  return value;
}

/**
 * `path` relative to `site/fonts/` (docs/site-settings.md, "Fonts"): no
 * leading `/`, no `..` segment, and a `.woff2` extension -- the CSP
 * allows no other font format from a site, and the build only ever
 * reads woff2.
 * @param {string[]} errors
 * @param {string} path
 * @param {unknown} value
 * @returns {string}
 */
function checkFontFilePath(errors, path, value) {
  const ok = typeof value === 'string' && value.length > 0 && value.endsWith('.woff2') && !value.startsWith('/') && !value.split('/').includes('..');
  if (!ok) {
    errors.push(`${path}: must be a relative .woff2 path inside site/fonts/`);
    return '';
  }
  return value;
}

/**
 * One self-hosted `files[]` entry of a `SiteFont`, each naming its own
 * weight and style (spec "2b. Fonts a site can choose": "its own woff2
 * files under `site/fonts/` (with the weight and style of each file,
 * and an optional unicode-range)").
 * @param {string[]} errors
 * @param {string} base
 * @param {any} raw
 * @param {number} index
 * @returns {import('./schema.js').SiteFontFile}
 */
function checkOneFontFile(errors, base, raw, index) {
  const fileBase = `${base}.files[${index}]`;
  const file = {
    path: checkFontFilePath(errors, `${fileBase}.path`, raw?.path),
    weight: checkFontWeight(errors, `${fileBase}.weight`, raw?.weight),
    style: checkFontStyle(errors, `${fileBase}.style`, raw?.style),
  };
  return typeof raw?.unicodeRange === 'string' ? { ...file, unicodeRange: raw.unicodeRange } : file;
}

/**
 * A font's `files[]` list: required, non-empty, each entry checked by
 * `checkOneFontFile`.
 * @param {string[]} errors
 * @param {string} base
 * @param {any} raw
 * @returns {import('./schema.js').SiteFontFile[]}
 */
function checkFontFiles(errors, base, raw) {
  const value = raw.files;
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${base}.files: must be a non-empty array`);
    return [];
  }
  return value.map((file, index) => checkOneFontFile(errors, base, file, index));
}

/**
 * The `package`-shape source of a `SiteFont`: an `@fontsource/*`
 * package, its subsets, and the weights to request from it.
 * @param {string[]} errors
 * @param {string} base
 * @param {any} raw
 * @returns {{ package: string, subsets: string[], weights: number[] }}
 */
function checkFontPackageSource(errors, base, raw) {
  const pkg = typeof raw.package === 'string' && raw.package.length > 0 ? raw.package : '';
  if (!pkg) errors.push(`${base}.package: must be a non-empty string`);
  return {
    package: pkg,
    subsets: checkFontSubsets(errors, `${base}.subsets`, raw.subsets),
    weights: checkFontWeights(errors, `${base}.weights`, raw.weights),
  };
}

/**
 * The `files`-shape source of a `SiteFont`: the site's own
 * `site/fonts/*.woff2` files, with the normalised `weights` derived as
 * every weight those files cover.
 * @param {string[]} errors
 * @param {string} base
 * @param {any} raw
 * @returns {{ files: import('./schema.js').SiteFontFile[], weights: number[] }}
 */
function checkFontFilesSource(errors, base, raw) {
  const files = checkFontFiles(errors, base, raw);
  return { files, weights: [...new Set(files.map((file) => file.weight))].sort((a, b) => a - b) };
}

/**
 * Exactly one of `package`/`files` is required on a `fonts[]` entry;
 * naming neither, or both, is an error.
 * @param {string[]} errors
 * @param {string} base
 * @param {any} raw
 * @returns {{ package: string, subsets: string[], weights: number[] } | { files: import('./schema.js').SiteFontFile[], weights: number[] }}
 */
function checkFontSource(errors, base, raw) {
  const hasPackage = raw?.package !== undefined;
  const hasFiles = raw?.files !== undefined;
  if (hasPackage && !hasFiles) return checkFontPackageSource(errors, base, raw);
  if (hasFiles && !hasPackage) return checkFontFilesSource(errors, base, raw);
  errors.push(`${base}: must have exactly one of 'package' (with subsets) or 'files'`);
  return { files: [], weights: [] };
}

/**
 * One `site.json` `fonts[]` entry (spec "2b. Fonts a site can choose"):
 * a family and either an `@fontsource/*` package (with its subsets and
 * the weights to request) or the site's own `site/fonts/*.woff2` files
 * (each naming its own weight and style).
 * @param {string[]} errors
 * @param {any} raw
 * @param {number} index
 * @returns {import('./schema.js').SiteFont}
 */
export function checkOneFont(errors, raw, index) {
  const base = `fonts[${index}]`;
  const family = requireString(errors, `${base}.family`, raw?.family) ? raw.family : '';
  const style = checkFontStyle(errors, `${base}.style`, raw?.style);
  return { family, style, ...checkFontSource(errors, base, raw) };
}
