// @ts-check
/**
 * The owner's event admin reads (Task 7): the event list, one event with
 * its edit form's options, and one event's entries (each with a
 * snippet, Ruling R6/R6a). Owner-only (`defineRoute`), so each is
 * `private, no-store`. Writes live in `ownerEventActions.js`.
 *
 * Ruling R2: every `:id` is parsed with `idParam` (`src/services/
 * params.js`), so a non-numeric id answers 404, never 400 or 500 -- an
 * unknown id and a malformed one look the same to the caller.
 */
import { NotFound } from '../http/errors.js';
import { defineRoute } from '../http/defineRoute.js';
import { adminEventDetail, adminEventEntries, adminEventList } from '../services/eventAdminViews.js';
import { HUB_OFFSET_MAX, idParam, integer } from '../services/params.js';

/** `GET /api/owner/events?q&offset`: page size 50. */
export const ownerEventsRoute = defineRoute({
  method: 'GET',
  path: '/api/owner/events',
  auth: 'owner',
  query: ['q', 'offset'],
  run: async ({ query }, deps) => adminEventList(deps, {
    q: typeof query.q === 'string' ? query.q : '',
    offset: integer('offset', query.offset, HUB_OFFSET_MAX, 0),
  }),
});

/** `GET /api/owner/events/:id`: the event plus the edit form's options; 404 when missing or merged. */
export const ownerEventRoute = defineRoute({
  method: 'GET',
  path: '/api/owner/events/:id',
  auth: 'owner',
  query: [],
  run: async ({ params }, deps) => {
    const view = await adminEventDetail(deps, idParam(params.id));
    if (!view) throw new NotFound();
    return view;
  },
});

/** `GET /api/owner/events/:id/entries`: the event's entries, each with a snippet; 404 when missing or merged. */
export const ownerEventEntriesRoute = defineRoute({
  method: 'GET',
  path: '/api/owner/events/:id/entries',
  auth: 'owner',
  query: [],
  run: async ({ params }, deps) => {
    const view = await adminEventEntries(deps, idParam(params.id));
    if (!view) throw new NotFound();
    return view;
  },
});
