// @ts-check
import { syndicationSource } from './syndication.js';
import { fxSource } from './fx.js';

export { parseTweetId, extractTweetIds } from './url.js';
export { normalize } from './normalize.js';
export { offlineFetch } from './offlineFetch.js';
export { BadRequest } from './errors.js';

/**
 * The registry of tweet data sources, queried in parallel by `fetchTweet`
 * (see `docs/decisions/0003-two-tweet-sources.md`).
 * @type {{name: string, fetch(deps: {fetchImpl: typeof fetch}, id: string): Promise<any|null>}[]}
 */
export const SOURCES = [syndicationSource, fxSource];
