// @ts-check
/**
 * `POST /api/owner/imports/:id/map` (Plan 3): one marker answer for a
 * translator's held entries, batch or per-entry, with optional remembering.
 */
import { NO_STORE } from '../http/handler.js';
import { BadRequest } from '../http/errors.js';
import { requireOwner } from '../services/session.js';
import { limit } from '../services/limits.js';
import { applyMapping } from '../services/importMapping.js';

/**
 * The map body, normalised: a marker plus exactly one speaker.
 * @param {any} body @param {Record<string,string>} params
 */
/** @param {any} speaker @returns {{ person: number }|{ role: string }|null} */
function speakerOf(speaker) {
  if (speaker === null || typeof speaker !== 'object') return null;
  if (typeof speaker.person === 'number') return { person: speaker.person };
  if (typeof speaker.role === 'string') return { role: speaker.role };
  return null;
}

/** @param {any} body @param {Record<string,string>} params */
function mappingInputOf(body, params) {
  const marker = typeof body?.marker === 'string' ? body.marker : '';
  const speaker = speakerOf(body?.speaker);
  if (marker === '' || speaker === null) throw new BadRequest('a marker and exactly one of person or role');
  return {
    jobId: Number(params.id),
    accountId: Number(body?.accountId),
    marker,
    speaker,
    remember: body?.remember === true,
    entries: Array.isArray(body?.entries) ? body.entries.map(Number) : undefined,
  };
}

/** `POST /api/owner/imports/:id/map`: one marker answer across a translator's held entries. */
export const importMapRoute = {
  method: 'POST',
  path: '/api/owner/imports/:id/map',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireOwner(deps, input);
    await limit(deps, 'owner', user.id);
    return applyMapping(deps, mappingInputOf(input.body, input.params));
  },
};
