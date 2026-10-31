// @ts-check
/**
 * Editing routes: `GET /api/item/:kind/:sourceId/edit` (the edit screen),
 * `POST .../edit` (apply changes), `POST .../edits/:editId/revert`
 * (owner), and `POST .../follow-ups` (translator/submitter/owner).
 */
import { NO_STORE } from '../http/handler.js';
import { NotFound } from '../http/errors.js';
import { defineRoute, fieldsOf } from '../http/defineRoute.js';
import { purgeReloadedItem } from '../services/cache.js';
import { editableOf, editItem, revertEdit, resolveForEdit } from '../services/editItem.js';
import { isApprovalRequired } from '../services/settings.js';
import { partLines, unmappedMarkers } from '../domain/lineFixes.js';

/** @param {any} details */
function editLines(details) {
  const parts = details?.parts ?? [];
  const fixes = details?.fixes ?? [];
  const speakers = details?.speakers ?? {};
  return { parts, lines: partLines(parts, fixes), unmapped: unmappedMarkers(parts, fixes, speakers) };
}

/** @param {import('../http/deps.js').Deps} deps @param {number} itemId @returns {Promise<any[]>} the owner's edit history, newest first */
async function editHistory(deps, itemId) {
  const { rows } = await deps.db.query('select id, created_at, created_by, before, reverts from item_edits where item_id = $1 order by id desc', [itemId]);
  return Promise.all(rows.map(async (/** @type {any} */ r) => {
    const by = r.created_by === null ? 'a fan' : (await deps.db.query('select display_name from users where id = $1', [r.created_by])).rows[0]?.display_name ?? 'a fan';
    return { id: r.id, at: r.created_at, by, changed: Object.keys(r.before ?? {}), reverted: r.reverts !== null };
  }));
}

/** @typedef {Partial<import('../services/editItem.js').EditableFields>} Changes */

/**
 * `{ changes }`: only the keys present are applied; `editItem` checks
 * them (and refuses the translator's text).
 * @param {unknown} raw
 * @returns {{ changes: Changes }}
 */
const changesBody = (raw) => ({ changes: /** @type {Changes} */ (fieldsOf(raw).changes ?? {}) });

export const editRoute = defineRoute({
  method: 'GET',
  path: '/api/item/:kind/:sourceId/edit',
  auth: 'user',
  cache: NO_STORE,
  query: [],
  run: async ({ params, user }, deps) => {
    const target = await resolveForEdit(deps, params.kind, params.sourceId, user);
    if (!target || !target.role) throw new NotFound();
    const fields = await editableOf(deps.db, target.kind, target.id);
    const details = /** @type {any} */ ((await target.kind.loadDetails(deps.db, [target.id], { includePending: true })).get(target.id));
    return {
      role: target.role, fields, ...editLines(details),
      reviewState: target.item.reviewState ?? null,
      history: target.role === 'owner' ? await editHistory(deps, target.id) : [],
    };
  },
});

export const applyRoute = defineRoute({
  method: 'POST',
  path: '/api/item/:kind/:sourceId/edit',
  auth: 'user',
  limit: 'edit',
  body: changesBody,
  run: async ({ params, body, user }, deps) => editItem(deps, { kind: params.kind, sourceId: params.sourceId, changes: body.changes, actor: user }),
});

/** Owner only, but a 404 (not a 403) for anyone else, so the route isn't advertised. */
export const revertRoute = defineRoute({
  method: 'POST',
  path: '/api/item/:kind/:sourceId/edits/:editId/revert',
  auth: 'user',
  run: async ({ params, user }, deps) => {
    if (!user.isOwner) throw new NotFound();
    return revertEdit(deps, { kind: params.kind, sourceId: params.sourceId, editId: Number(params.editId), actor: user });
  },
});

export const followUpsRoute = defineRoute({
  method: 'POST',
  path: '/api/item/:kind/:sourceId/follow-ups',
  auth: 'user',
  limit: 'followUps',
  run: async ({ params, user }, deps) => {
    const target = await resolveForEdit(deps, params.kind, params.sourceId, user);
    if (!target || !target.role) throw new NotFound();
    if (typeof target.kind.checkFollowUps !== 'function') throw new NotFound();
    const pending = await isApprovalRequired(deps.db);
    const added = await target.kind.checkFollowUps(deps, target.id, { actor: user.id, pending });
    // A new public part changes the entry, its event and its translator pages.
    // The page reloads the entry next, so its own CDN copy is deleted before
    // this response (the rest is invalidated after it).
    if (added.added > 0 && !pending) await purgeReloadedItem(deps, target.id);
    return { ...added, pending };
  },
});
