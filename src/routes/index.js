// @ts-check
/**
 * The one route table: `api/index.js` dispatches through it, the dev
 * server shares it, and the build writes `vercel.json`'s function
 * rewrites from `rewrites`. First match wins. The function sees the
 * original request URL, so `/api/*` routes match `/api/...` and the
 * link-preview meta routes match their page paths (`/e/:slug`, and
 * `<urlPrefix>:sourceId` per kind), derived from `src/pages.js` and the
 * kinds registry.
 */
import { kindsRegistry } from '../kinds/_registry.js';
import { pages } from '../pages.js';
import { unnamedSource } from '../http/router.js';
import { route as home } from './home.js';
import { route as event } from './event.js';
import { route as item } from './item.js';
import { route as refresh } from './refresh.js';
import { route as search } from './search.js';
import { route as filters } from './filters.js';
import { route as person } from './person.js';
import { route as account } from './account.js';
import { route as video } from './video.js';
import { route as authXStart, callbackRoute as authXCallback } from './authX.js';
import { route as authGoogleStart, callbackRoute as authGoogleCallback } from './authGoogle.js';
import { meRoute, addedRoute, translationsRoute, removeEntriesRoute, restoreEntriesRoute, optOutRoute, optInRoute, welcomedRoute, setNameRoute, signOutRoute, signOutAllRoute, deleteAccountRoute } from './me.js';
import { route as authDev } from './authDev.js';
import { optionsRoute, previewRoute, addRoute, addPersonRoute } from './add.js';
import { editRoute, applyRoute, revertRoute, followUpsRoute } from './edit.js';
import { metaRoutes } from './meta.js';
import { route as reportsRoute } from './reports.js';
import { ownerRoute, approvalRoute, reviewRoute, hideReportRoute, restoreReportRoute, dismissReportRoute, usersRoute, blockUserRoute, unblockUserRoute, signInAlertRoute } from './owner.js';
// scaffold:route-imports (`npm run new route <name>` adds its import above this line)

/** @type {import('../http/handler.js').Route[]} */
export const routes = [
  home, event, item, refresh, search, filters, person, account, video,
  authXStart, authXCallback,
  authGoogleStart, authGoogleCallback,
  meRoute, addedRoute, translationsRoute, removeEntriesRoute, restoreEntriesRoute, optOutRoute, optInRoute, welcomedRoute, setNameRoute, signOutRoute, signOutAllRoute, deleteAccountRoute,
  authDev,
  optionsRoute, previewRoute, addRoute, addPersonRoute,
  editRoute, applyRoute, revertRoute, followUpsRoute,
  reportsRoute,
  ownerRoute, approvalRoute, reviewRoute, hideReportRoute, restoreReportRoute, dismissReportRoute,
  usersRoute, blockUserRoute, unblockUserRoute, signInAlertRoute,
  // scaffold:routes (`npm run new route <name>` adds its route above this line)
  ...metaRoutes(pages, Object.values(kindsRegistry)),
];

/** The one function's path (`api/index.js`): every function rewrite's destination. */
export const FUNCTION_PATH = '/api';

/**
 * `vercel.json`'s rewrites to the function: every `/api/*` path, then one
 * per route on a page path (the meta routes). Unnamed sources only (see
 * `unnamedSource`), so Vercel adds no query params, and the destination
 * is always exactly `/api`: the function gets the original URL either way.
 * @type {{ source: string, destination: string }[]}
 */
export const rewrites = [
  { source: '/api/(.*)', destination: FUNCTION_PATH },
  ...[...new Set(routes.filter((r) => !r.path.startsWith('/api/')).map((r) => unnamedSource(r.path)))]
    .map((source) => ({ source, destination: FUNCTION_PATH })),
];
