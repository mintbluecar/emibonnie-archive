// @ts-check
// Fixture standing in for a built `public/site/site.js`, used by
// test/components/*.test.js via test/helpers/siteFixture.js's resolve
// hook (same technique as test/core/site.test.js). Copy is the real
// merged engine + translation-kind copy, read from disk, so a component
// test is exercising the actual shipped strings, not a hand-copied
// subset that could drift from src/site/copyDefaults.json.
import { readFileSync } from 'node:fs';

/** @param {string} relativePath @returns {Record<string, string>} */
function readJson(relativePath) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'));
}

export const site = {
  name: 'fixture archive',
  wordmark: { accent: 'fix', rest: 'ture archive' },
  tagline: 'fixture tagline',
  sourceLanguage: 'th',
  timezone: 'Asia/Bangkok',
  lowercaseNames: true,
  logo: null,
};

export const copy = {
  ...readJson('../../../src/site/copyDefaults.json'),
  ...readJson('../../../src/kinds/translation/copy.json'),
};
