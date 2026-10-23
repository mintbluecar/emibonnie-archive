// @ts-check
/**
 * The owner's `npm run remap` (Task 10c): re-points markers on one
 * archived item -- a marker to a known person, or to a generic role --
 * through its kind's `remapSpeakers`, in one transaction under the given
 * actor. Never names a kind. Refuses an unknown kind or person (via
 * `resolveSpeakerRefs`), an item that isn't archived, and one that is
 * hidden or removed.
 */
import { kindsOf } from './cards.js';
import { loadContext } from './ingestContext.js';
import { resolveSpeakerRefs } from './intakeRefs.js';
import { findSourceOwner } from '../repo/itemSources.js';
import { BadRequest } from '../domain/errors.js';

/** @typedef {import('./intakeRefs.js').SpeakerRefs} SpeakerRefs */
/** @typedef {import('../kinds/defineKind.js').RemapResult} RemapResult */

/**
 * @param {{ db: any, site: import('../site/schema.js').Site, kinds?: Record<string, Readonly<import('../kinds/defineKind.js').Kind>> }} deps
 * @param {string} kindName
 */
function remappableKind(deps, kindName) {
  const kind = kindsOf(deps)[kindName];
  if (!kind) throw new BadRequest(`unknown kind: ${kindName}`);
  const remap = kind.remapSpeakers;
  if (typeof remap !== 'function') throw new BadRequest(`kind ${kindName} has no speakers to remap`);
  return { name: kind.name, platform: kind.platform, remap };
}

/**
 * @param {{ db: any, site: import('../site/schema.js').Site, kinds?: Record<string, Readonly<import('../kinds/defineKind.js').Kind>> }} deps
 * @param {{ kind?: string, sourceId: string, refs: SpeakerRefs, actor: string }} request
 * @returns {Promise<RemapResult & { itemId: number }>}
 */
export async function remapItem(deps, { kind: kindName = 'translation', sourceId, refs, actor }) {
  const kind = remappableKind(deps, kindName);
  if (Object.keys(refs).length === 0) throw new BadRequest('nothing to remap: give at least one <marker>=person:<igHandle> or <marker>=role:<role>');
  const owner = await findSourceOwner(deps.db, { kind: kind.name, platform: kind.platform, externalId: sourceId, roles: ['primary'] });
  if (!owner) throw new BadRequest(`no archived ${kind.name} item for ${sourceId}`);
  if (owner.state === 'removed') throw new BadRequest(`item ${owner.itemId} (${sourceId}) is hidden or removed: restore it first`);
  const map = await resolveSpeakerRefs(deps.db, refs);
  const ctx = await loadContext(deps, {});
  const result = await deps.db.transaction((/** @type {any} */ tx) => kind.remap(tx, { itemId: owner.itemId, map, ctx }), { actor });
  return { itemId: owner.itemId, ...result };
}
