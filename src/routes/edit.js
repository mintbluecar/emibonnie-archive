// @ts-check
/**
 * Editing routes: `GET /api/item/:kind/:sourceId/edit` (the edit screen),
 * `POST .../edit` (apply changes), `POST .../edits/:editId/revert`
 * (owner), and `POST .../follow-ups` (translator/submitter/owner).
 */
import { NO_STORE } from '../http/handler.js';
import { NotFound } from '../http/errors.js';
import { requireUser } from '../services/session.js';
import { limit } from '../services/limits.js';
import { editableOf, editItem, revertEdit, resolveForEdit } from '../services/editItem.js';
import { reviewStateOf } from '../services/ingestWrite.js';
import { partLines, unmappedMarkers } from '../domain/lineFixes.js';

/** @param {any} details */
function editLines(details) {
  const parts = details?.parts ?? [];
  const fixes = details?.fixes ?? [];
  const speakers = details?.speakers ?? {};
  return { parts, lines: partLines(parts, fixes), unmapped: unmappedMarkers(parts, fixes, speakers) };
}

/** @param {any} deps @param {number} itemId @returns {Promise<any[]>} the owner's edit history, newest first */
async function editHistory(deps, itemId) {
  const { rows } = await deps.db.query('select id, created_at, created_by, before, reverts from item_edits where item_id = $1 order by id desc', [itemId]);
  return Promise.all(rows.map(async (/** @type {any} */ r) => {
    const by = r.created_by === null ? 'a fan' : (await deps.db.query('select display_name from users where id = $1', [r.created_by])).rows[0]?.display_name ?? 'a fan';
    return { id: r.id, at: r.created_at, by, changed: Object.keys(r.before ?? {}), reverted: r.reverts !== null };
  }));
}

export const editRoute = {
  method: 'GET',
  path: '/api/item/:kind/:sourceId/edit',
  cache: NO_STORE,
  query: [],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    const target = await resolveForEdit(deps, input.params.kind, input.params.sourceId, user);
    if (!target || !target.role) throw new NotFound();
    const fields = await editableOf(deps.db, target.kind, target.id);
    const details = /** @type {any} */ ((await target.kind.loadDetails(deps.db, [target.id])).get(target.id));
    return { role: target.role, fields, ...editLines(details), history: target.role === 'owner' ? await editHistory(deps, target.id) : [] };
  },
};

export const applyRoute = {
  method: 'POST',
  path: '/api/item/:kind/:sourceId/edit',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    await limit(deps, 'edit', user.id);
    const changes = /** @type {any} */ (input.body)?.changes ?? {};
    return editItem(deps, { kind: input.params.kind, sourceId: input.params.sourceId, changes, actor: user });
  },
};

export const revertRoute = {
  method: 'POST',
  path: '/api/item/:kind/:sourceId/edits/:editId/revert',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    if (!user.isOwner) throw new NotFound();
    return revertEdit(deps, { kind: input.params.kind, sourceId: input.params.sourceId, editId: Number(input.params.editId), actor: user });
  },
};

export const followUpsRoute = {
  method: 'POST',
  path: '/api/item/:kind/:sourceId/follow-ups',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    await limit(deps, 'followUps', user.id);
    const target = await resolveForEdit(deps, input.params.kind, input.params.sourceId, user);
    if (!target || !target.role) throw new NotFound();
    if (typeof target.kind.checkFollowUps !== 'function') throw new NotFound();
    const pending = await deps.db.transaction(
      (/** @type {any} */ tx) => reviewStateOf(tx, { common: { textEnteredManually: false }, actor: user.id, creditedUserId: null }),
      { actor: user.id },
    ) === 'pending';
    const added = await target.kind.checkFollowUps(deps, target.id, { actor: user.id, pending });
    return { ...added, pending };
  },
};
