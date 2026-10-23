// @ts-check
/**
 * The one route table: `api/[...route].js` dispatches through it, the
 * dev server shares it, and the build writes `vercel.json`'s rewrites from
 * `rewrites`. First match wins, so the event meta route precedes the
 * generic item meta route. The meta routes are also registered on the
 * original page paths (`/e/:slug`, `/t/:sourceId`), so they answer
 * whether the function sees the rewritten path or the original one.
 */
import { kindsRegistry } from '../kinds/_registry.js';
import { metaRewrites } from '../services/meta.js';
import { route as home } from './home.js';
import { route as event } from './event.js';
import { route as item } from './item.js';
import { route as refresh } from './refresh.js';
import { route as search } from './search.js';
import { route as filters } from './filters.js';
import { route as person } from './person.js';
import { route as account } from './account.js';
import { route as video } from './video.js';
import { eventMeta, itemMeta, pageMetaRoutes } from './meta.js';
// scaffold:route-imports (`npm run new route <name>` adds its import above this line)

/** @type {import('../http/handler.js').Route[]} */
export const routes = [
  home, event, item, refresh, search, filters, person, account, video, eventMeta, itemMeta,
  // scaffold:routes (`npm run new route <name>` adds its route above this line)
  ...pageMetaRoutes(Object.values(kindsRegistry)),
];

/** Page rewrites to the meta routes (`/e/:slug`, and `<urlPrefix>:id` per kind). */
export const rewrites = metaRewrites(kindsRegistry);
