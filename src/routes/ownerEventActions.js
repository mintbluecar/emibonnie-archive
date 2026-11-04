// @ts-check
/**
 * The owner's writes on an event (Task 7): editing its own fields,
 * merging events into one, moving ticked entries into another event, and
 * splitting entries into a new one. Owner-only and `limit: 'owner'`
 * (`defineRoute`), each `cache: 'no-store'`. The body parsers below only
 * shape the JSON into what each service expects; the deep checks --
 * `eventFields.js`'s `checkFields` for `fields`, `checkIds` for every id
 * list -- run inside the services themselves, so they aren't repeated
 * here (a wrong-shaped field still answers 400, just from the service).
 *
 * Ruling R2: `ownerEventMergeRoute`'s literal `/merge` is registered
 * before `ownerEventEditRoute`'s `/:id` in `src/routes/index.js` -- both
 * are 4-segment POSTs, and the router matches in registration order, so
 * `/:id` would otherwise swallow `/merge` as `id: 'merge'`.
 */
import { defineRoute, fieldsOf } from '../http/defineRoute.js';
import { createEventWithEntries, editEvent, mergeEvents } from '../services/eventAdmin.js';
import { moveEntries } from '../services/eventMoves.js';
import { idParam } from '../services/params.js';

/** The body is `EventFields` itself, checked by `eventFields.js`'s `checkFields`. @param {unknown} raw */
const fieldsBody = (raw) => fieldsOf(raw);

/** `{ keepId, mergeIds, fields }`: `fields` always an object, checked by the service. @param {unknown} raw */
function mergeBody(raw) {
  const b = fieldsOf(raw);
  return { keepId: b.keepId, mergeIds: b.mergeIds, fields: fieldsOf(b.fields) };
}

/** `{ itemIds, toEventId }`, checked by the service. @param {unknown} raw */
function moveBody(raw) {
  const b = fieldsOf(raw);
  return { itemIds: b.itemIds, toEventId: b.toEventId };
}

/** `{ itemIds, fields }`: `fields` always an object, checked by the service. @param {unknown} raw */
function splitBody(raw) {
  const b = fieldsOf(raw);
  return { itemIds: b.itemIds, fields: fieldsOf(b.fields) };
}

/** `POST /api/owner/events/:id`: edit mode. */
export const ownerEventEditRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/events/:id',
  auth: 'owner',
  limit: 'owner',
  body: fieldsBody,
  run: async ({ params, body, user }, deps) =>
    editEvent(deps, { eventId: idParam(params.id), fields: /** @type {any} */ (body), actor: user }),
});

/** `POST /api/owner/events/merge`: merge mode. */
export const ownerEventMergeRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/events/merge',
  auth: 'owner',
  limit: 'owner',
  body: mergeBody,
  run: async ({ body, user }, deps) => mergeEvents(deps, {
    keepId: /** @type {any} */ (body.keepId), mergeIds: /** @type {any} */ (body.mergeIds),
    fields: /** @type {any} */ (body.fields), actor: user,
  }),
});

/** `POST /api/owner/events/:id/move`: spec ③'s "Move ticked to". */
export const ownerEventMoveRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/events/:id/move',
  auth: 'owner',
  limit: 'owner',
  body: moveBody,
  run: async ({ params, body, user }, deps) => moveEntries(deps, {
    fromEventId: idParam(params.id), itemIds: /** @type {any} */ (body.itemIds),
    toEventId: /** @type {any} */ (body.toEventId), actor: user,
  }),
});

/** `POST /api/owner/events/:id/split`: create mode. */
export const ownerEventSplitRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/events/:id/split',
  auth: 'owner',
  limit: 'owner',
  body: splitBody,
  run: async ({ params, body, user }, deps) => createEventWithEntries(deps, {
    fromEventId: idParam(params.id), itemIds: /** @type {any} */ (body.itemIds),
    fields: /** @type {any} */ (body.fields), actor: user,
  }),
});
