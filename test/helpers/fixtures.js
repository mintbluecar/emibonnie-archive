// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { offlineFetch } from '../../src/sources/offlineFetch.js';

export { IDS } from '../fixtures/tweets/build.mjs';

/** Directory of the synthetic tweet fixtures built by `build.mjs`. */
export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/tweets/', import.meta.url));

/**
 * `deps` for `fetchTweet`/`fetchThread` tests: serves the synthetic
 * fixtures instead of hitting the real syndication/FxTwitter endpoints.
 * @returns {{fetchImpl: typeof fetch}}
 */
export function fixtureDeps() {
  return { fetchImpl: offlineFetch(FIXTURES_DIR) };
}

/**
 * `deps` like `fixtureDeps()`, but requests to any host in `failHosts`
 * reject instead of resolving, the way the real `fetch` rejects when
 * `redirect: 'error'` meets a redirect.
 * @param {string[]} failHosts
 * @returns {{fetchImpl: typeof fetch}}
 */
export function fixtureDepsFailing(failHosts) {
  const real = offlineFetch(FIXTURES_DIR);
  const fetchImpl = async (/** @type {any} */ input, /** @type {any} */ init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (failHosts.includes(url.hostname)) throw new TypeError('fetch failed: redirected');
    return real(input, init);
  };
  return { fetchImpl: /** @type {typeof fetch} */ (fetchImpl) };
}

/**
 * Reads a fixture's raw syndication/fx JSON straight off disk, for
 * testing `normalize` directly (it's pure, so it doesn't need `deps`).
 * @param {string} id
 * @returns {{syndication: any, fx: any}}
 */
export function loadRaw(id) {
  const synPath = path.join(FIXTURES_DIR, `${id}.syn.json`);
  const fxPath = path.join(FIXTURES_DIR, `${id}.fx.json`);
  return {
    syndication: existsSync(synPath) ? JSON.parse(readFileSync(synPath, 'utf8')) : null,
    fx: existsSync(fxPath) ? JSON.parse(readFileSync(fxPath, 'utf8')) : null,
  };
}
