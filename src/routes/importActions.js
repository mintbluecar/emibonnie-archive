// @ts-check
/**
 * The owner's actions on an import job (Plan 3): publish, skip, archive and
 * retry. Separate from the read routes to keep both files small.
 */
import { NO_STORE } from '../http/handler.js';
import { requireOwner } from '../services/session.js';
import { limit } from '../services/limits.js';
import { archiveRow, publishRows, retryRows, skipRow } from '../services/importActions.js';

/** @param {any} deps @param {import('../http/handler.js').RouteInput} input */
async function ownerOf(deps, input) {
  const user = await requireOwner(deps, input);
  await limit(deps, 'owner', user.id);
  return user;
}

export const importPublishRoute = {
  method: 'POST',
  path: '/api/owner/imports/:id/publish',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await ownerOf(deps, input);
    const scope = /** @type {any} */ (input.body)?.scope === 'all' ? 'all' : 'ready';
    return publishRows(deps, { jobId: Number(input.params.id), scope, actor: user });
  },
};

export const importSkipRoute = {
  method: 'POST',
  path: '/api/owner/imports/:id/rows/:rowId/skip',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await ownerOf(deps, input);
    return skipRow(deps, { jobId: Number(input.params.id), rowId: Number(input.params.rowId), actor: user });
  },
};

export const importArchiveRoute = {
  method: 'POST',
  path: '/api/owner/imports/:id/rows/:rowId/archive',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await ownerOf(deps, input);
    return archiveRow(deps, { jobId: Number(input.params.id), rowId: Number(input.params.rowId), actor: user });
  },
};

export const importRetryRoute = {
  method: 'POST',
  path: '/api/owner/imports/:id/retry',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await ownerOf(deps, input);
    return retryRows(deps, { jobId: Number(input.params.id), actor: user });
  },
};
