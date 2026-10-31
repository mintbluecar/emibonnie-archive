// @ts-check
/**
 * The web add flow: `GET /api/add/options`, `POST /api/add/preview`,
 * `POST /api/add`, and `POST /api/people` ("＋ add a new person"). All
 * signed-in; the writes go through the Origin check and are rate-limited.
 */
import { NO_STORE } from '../http/handler.js';
import { BadRequest } from '../http/errors.js';
import { defineRoute, fieldsOf } from '../http/defineRoute.js';
import { requireDisplayName } from '../services/session.js';
import { addOptions, previewAdd, addItem, addNewPerson } from '../services/addFlow.js';

const IG_HANDLE = /^[a-z0-9._]{1,30}$/i;

/** `{ displayName, igHandle }`: the handle must look like an Instagram one. @param {unknown} raw */
function personBody(raw) {
  const body = fieldsOf(raw);
  const displayName = typeof body.displayName === 'string' ? body.displayName : '';
  const igHandle = typeof body.igHandle === 'string' ? body.igHandle : '';
  if (!IG_HANDLE.test(igHandle)) throw new BadRequest('bad_handle');
  return { displayName, igHandle };
}

export const optionsRoute = defineRoute({
  method: 'GET',
  path: '/api/add/options',
  auth: 'user',
  cache: NO_STORE,
  query: [],
  run: async (_ctx, deps) => addOptions(deps),
});

/** The add form's body goes to the add flow as sent; `previewAdd`/`addItem` check it. */
export const previewRoute = defineRoute({
  method: 'POST',
  path: '/api/add/preview',
  auth: 'user',
  limit: 'addPreview',
  run: async ({ body, user }, deps) => {
    requireDisplayName(user);
    return previewAdd(deps, user, body);
  },
});

export const addRoute = defineRoute({
  method: 'POST',
  path: '/api/add',
  auth: 'user',
  limit: 'add',
  run: async ({ body, user }, deps) => {
    requireDisplayName(user);
    return addItem(deps, user, body);
  },
});

export const addPersonRoute = defineRoute({
  method: 'POST',
  path: '/api/people',
  auth: 'user',
  limit: 'addPerson',
  body: personBody,
  run: async ({ body, user }, deps) => addNewPerson(deps, { ...body, actor: user.id }),
});
