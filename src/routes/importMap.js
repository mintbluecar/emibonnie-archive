// @ts-check
/**
 * `POST /api/owner/imports/:id/map` (Plan 3): one marker answer for a
 * translator's held entries, batch or per-entry, with optional remembering;
 * or "not a speaker" (`speaker: { plain: true }`), which is never remembered.
 */
import { BadRequest } from '../http/errors.js';
import { defineRoute, fieldsOf } from '../http/defineRoute.js';
import { applyMapping, applyNotSpeaker } from '../services/importMapping.js';
import { ROLES } from '../domain/constants.js';

/**
 * A person, a role, or `{ plain: true }` ("not a speaker").
 * @param {unknown} raw @returns {import('../domain/speakers.js').Speaker|{ plain: true }|null}
 */
function speakerOf(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const speaker = fieldsOf(raw);
  if (typeof speaker.person === 'number') return { person: speaker.person };
  if (speaker.plain === true) return { plain: true };
  const role = ROLES.find((known) => known === speaker.role);
  if (role) return { role };
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
  if (marker === '' || speaker === null) throw new BadRequest('a marker and exactly one of person, role or plain');
  // null: the "translator unknown" card, entries credited to no one.
  const accountId = body.accountId === null ? null : Number(body.accountId);
  if (accountId !== null && !Number.isInteger(accountId)) throw new BadRequest('accountId is a number or null');
  return {
    accountId,
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
  run: async ({ params, body: { speaker, remember, ...rest }, user }, deps) => {
    const input = { jobId: Number(params.id), ...rest, actor: user.id };
    if ('plain' in speaker) return applyNotSpeaker(deps, input);
    return applyMapping(deps, { ...input, speaker, remember });
  },
});
