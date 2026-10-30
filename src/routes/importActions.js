// @ts-check
/**
 * The owner's actions on an import job (Plan 3): publish, skip, archive and
 * retry. Separate from the read routes to keep both files small. Owner-only,
 * and each counts against the `owner` limit (`defineRoute`).
 */
import { defineRoute, fieldsOf } from '../http/defineRoute.js';
import { archiveRow, publishRows, retryRows, skipRow } from '../services/importActions.js';

/** `{ scope }`: `'all'`, else the ready rows only. @param {unknown} raw @returns {{ scope: 'ready'|'all' }} */
const publishBody = (raw) => ({ scope: fieldsOf(raw).scope === 'all' ? 'all' : 'ready' });

export const importPublishRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/imports/:id/publish',
  auth: 'owner',
  limit: 'owner',
  body: publishBody,
  run: async ({ params, body, user }, deps) => publishRows(deps, { jobId: Number(params.id), scope: body.scope, actor: user }),
});

export const importSkipRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/imports/:id/rows/:rowId/skip',
  auth: 'owner',
  limit: 'owner',
  run: async ({ params, user }, deps) => skipRow(deps, { jobId: Number(params.id), rowId: Number(params.rowId), actor: user }),
});

export const importArchiveRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/imports/:id/rows/:rowId/archive',
  auth: 'owner',
  limit: 'owner',
  run: async ({ params, user }, deps) => archiveRow(deps, { jobId: Number(params.id), rowId: Number(params.rowId), actor: user }),
});

export const importRetryRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/imports/:id/retry',
  auth: 'owner',
  limit: 'owner',
  run: async ({ params, user }, deps) => retryRows(deps, { jobId: Number(params.id), actor: user }),
});
