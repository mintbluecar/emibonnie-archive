// @ts-check
/**
 * The web add flow: `GET /api/add/options`, `POST /api/add/preview`,
 * `POST /api/add`, and `POST /api/people` ("＋ add a new person"). All
 * signed-in; the writes go through the Origin check and are rate-limited.
 */
import { NO_STORE } from '../http/handler.js';
import { BadRequest } from '../http/errors.js';
import { requireUser, requireDisplayName } from '../services/session.js';
import { limit } from '../services/limits.js';
import { addOptions, previewAdd, addItem, addNewPerson } from '../services/addFlow.js';

const IG_HANDLE = /^[a-z0-9._]{1,30}$/i;

export const optionsRoute = {
  method: 'GET',
  path: '/api/add/options',
  cache: NO_STORE,
  query: [],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    await requireUser(deps, input);
    return addOptions(deps);
  },
};

export const previewRoute = {
  method: 'POST',
  path: '/api/add/preview',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    requireDisplayName(user);
    await limit(deps, 'addPreview', user.id);
    return previewAdd(deps, user, input.body);
  },
};

export const addRoute = {
  method: 'POST',
  path: '/api/add',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    requireDisplayName(user);
    await limit(deps, 'add', user.id);
    return addItem(deps, user, input.body);
  },
};

export const addPersonRoute = {
  method: 'POST',
  path: '/api/people',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    await limit(deps, 'addPerson', user.id);
    const body = /** @type {any} */ (input.body);
    const displayName = typeof body?.displayName === 'string' ? body.displayName : '';
    const igHandle = typeof body?.igHandle === 'string' ? body.igHandle : '';
    if (!IG_HANDLE.test(igHandle)) throw new BadRequest('bad_handle');
    return addNewPerson(deps, { displayName, igHandle, actor: user.id });
  },
};
