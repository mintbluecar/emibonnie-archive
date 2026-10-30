// @ts-check
/**
 * `POST /api/owner/imports/:id/map` (Plan 3): one marker answer for a
 * translator's held entries, batch or per-entry, with optional remembering.
 */
import { BadRequest } from '../http/errors.js';
import { defineRoute, fieldsOf } from '../http/defineRoute.js';
import { applyMapping } from '../services/importMapping.js';

/** @param {unknown} raw @returns {{ person: number }|{ role: string }|null} */
function speakerOf(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const speaker = fieldsOf(raw);
  if (typeof speaker.person === 'number') return { person: speaker.person };
  if (typeof speaker.role === 'string') return { role: speaker.role };
  return null;
}

/**
 * The map body, normalised: a marker plus exactly one speaker.
 * @param {unknown} raw
 */
function mappingBody(raw) {
  const body = fieldsOf(raw);
  const marker = typeof body.marker === 'string' ? body.marker : '';
  const speaker = speakerOf(body.speaker);
  if (marker === '' || speaker === null) throw new BadRequest('a marker and exactly one of person or role');
  return {
    accountId: Number(body.accountId),
    marker,
    speaker,
    remember: body.remember === true,
    entries: Array.isArray(body.entries) ? body.entries.map(Number) : undefined,
  };
}

/** `POST /api/owner/imports/:id/map`: one marker answer across a translator's held entries. */
export const importMapRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/imports/:id/map',
  auth: 'owner',
  limit: 'owner',
  body: mappingBody,
  run: async ({ params, body }, deps) => applyMapping(deps, { jobId: Number(params.id), ...body }),
});
