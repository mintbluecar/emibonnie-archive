// @ts-check
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateSite } from './schema.js';

/** Thrown by `loadSite` when a site's `site.json` is missing or invalid. */
export class SiteConfigError extends Error {
  /** @param {string[]} errors */
  constructor(errors) {
    super(`invalid site.json:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
    this.name = 'SiteConfigError';
    /** @type {string[]} */
    this.errors = errors;
  }
}

/**
 * Loads and validates a site's `site.json`. Throws `SiteConfigError`
 * listing every error when it's missing, unparsable, or invalid.
 * @param {string} [dir]
 * @returns {import('./schema.js').Site}
 */
export function loadSite(dir = process.env.SITE_DIR ?? 'site') {
  const filePath = path.join(dir, 'site.json');
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (/** @type {any} */ err) {
    throw new SiteConfigError([`${filePath}: ${err.message}`]);
  }

  const result = validateSite(raw);
  if (!result.ok) throw new SiteConfigError(result.errors);
  return result.site;
}

/**
 * Formats a person's display name per the site's `lowercaseNames` setting.
 * @param {import('./schema.js').Site} site
 * @param {string} name
 * @returns {string}
 */
export function formatName(site, name) {
  return site.lowercaseNames ? name.toLowerCase() : name;
}
