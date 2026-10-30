// @ts-check
import { defineRoute } from '../http/defineRoute.js';
import { itemViewer } from '../services/itemPage.js';

/**
 * `GET /api/item/:kind/:sourceId/viewer`: the signed-in caller's own
 * fields on an item page (`ItemViewerVM`) -- their edit and follow-up
 * buttons, the fresh `editOpenUntil`, and, for the owner, a held entry's
 * page. Private (`auth: 'user'` GETs default to `private, no-store`), so
 * `/api/item/:kind/:sourceId` stays one cached answer for everyone. The
 * page asks only when the `signed_in` hint cookie is present.
 */
export const route = defineRoute({
  method: 'GET',
  path: '/api/item/:kind/:sourceId/viewer',
  auth: 'user',
  run: ({ params, user }, deps) => itemViewer(deps, params.kind, params.sourceId, user),
});
