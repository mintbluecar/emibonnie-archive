// @ts-check
/**
 * Editing (Plan 2a Task 10): who may edit an item, what they can change,
 * and applying the change with a full audit trail (`item_edits` before/
 * after). The translator's text is never edited: changes are placement,
 * event, category, client, the speaker map, line-level speaker fixes and
 * the subbed flag. Kind-specific rows go through the Kind contract;
 * the shared `items` row through the repo.
 */
import { BadRequest, Conflict, Forbidden, NotFound } from '../domain/errors.js';
import { kindNamed } from './cards.js';
import { loadContext } from './ingestContext.js';
import { updatePlacement, updateLookups, getItem } from '../repo/items.js';
import { findLookup, ensureLookup } from '../repo/lookups.js';
import { findVisibleItemId } from '../repo/cards.js';
import { findItemIdBySource } from '../repo/itemState.js';
import { eventExists } from '../repo/events.js';
import { validateFixes } from '../domain/lineFixes.js';
import { itemChangeTags, purgeForTags } from './cache.js';

/** @typedef {import('../db/common.js').Db} Db */
/** @typedef {import('./session.js').SessionUser} SessionUser */
/** @typedef {import('../domain/speakers.js').SpeakerMap} SpeakerMap */
/** @typedef {import('../domain/lineFixes.js').LineFix} LineFix */

/**
 * @typedef {{ placement: import('../domain/constants.js').Placement, eventId: number|null,
 *   categoryName: string|null, clientName: string|null, speakers: SpeakerMap,
 *   lineFixes: LineFix[], subbed: boolean }} EditableFields
 */

/**
 * Who may edit an item: the owner, the credited translator, the submitter.
 * @param {SessionUser} user
 * @param {{ createdBy: string|null, creditedAccountId: number|null }} item
 * @returns {'submitter'|'translator'|'owner'|null}
 */
export function canEdit(user, item) {
  if (user.isOwner) return 'owner';
  if (item.creditedAccountId !== null && user.translatorAccountIds.includes(item.creditedAccountId)) return 'translator';
  if (item.createdBy === user.id) return 'submitter';
  return null;
}

/**
 * The caller's edit role for an archived item, for a view's `canEdit`
 * flag. Null when the item doesn't exist. The one place both the edit
 * service and the item view ask "may this user edit this?".
 * @param {any} db @param {number} itemId @param {SessionUser} user
 * @returns {Promise<'submitter'|'translator'|'owner'|null>}
 */
export async function editRoleFor(db, itemId, user) {
  const item = /** @type {any} */ (await getItem(db, itemId));
  if (!item) return null;
  return canEdit(user, { createdBy: item.createdBy ?? null, creditedAccountId: item.creditedAccountId ?? null });
}

/** @param {any} db @param {'categories'|'clients'} table @param {number|null} id @returns {Promise<string|null>} */
async function nameOf(db, table, id) {
  if (id === null) return null;
  const { rows } = await db.query(`select name from ${table} where id = $1`, [id]);
  return rows[0]?.name ?? null;
}

/**
 * The item's current editable fields, for the edit screen. Reads the
 * shared row and the kind's own details through its `loadDetails`.
 * @param {any} db @param {{ name: string, loadDetails: Function }} kind @param {number} itemId
 * @returns {Promise<EditableFields>}
 */
export async function editableOf(db, kind, itemId) {
  const row = /** @type {any} */ (await getItem(db, itemId));
  if (!row) throw new BadRequest('item not found');
  const details = /** @type {any} */ ((await kind.loadDetails(db, [itemId], { includePending: true })).get(itemId));
  return {
    placement: /** @type {import('../domain/constants.js').Placement} */ (row.placement),
    eventId: row.eventId ?? null,
    categoryName: await nameOf(db, 'categories', row.categoryId ?? null),
    clientName: await nameOf(db, 'clients', row.clientId ?? null),
    speakers: details?.speakers ?? {},
    lineFixes: details?.fixes ?? [],
    subbed: details?.subbed === true,
  };
}

/** @param {any} tx @param {string|null|undefined} name @param {boolean} canCreate @param {'categories'|'clients'} table */
async function lookupId(tx, name, canCreate, table) {
  if (name === undefined || name === null) return null;
  if (typeof name !== 'string' || name.trim() === '') return null;
  const found = await findLookup(tx, table, name);
  if (found !== null) return found;
  if (canCreate) return ensureLookup(tx, table, name);
  throw new BadRequest(`unknown ${table === 'categories' ? 'category' : 'client'}`);
}

/** @param {EditableFields} before @param {EditableFields} after */
function diffOf(before, after) {
  const keys = /** @type {(keyof EditableFields)[]} */ (['placement', 'eventId', 'categoryName', 'clientName', 'speakers', 'lineFixes', 'subbed']);
  const b = /** @type {Record<string, unknown>} */ ({});
  const a = /** @type {Record<string, unknown>} */ ({});
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a };
}

/** @param {EditableFields} before @param {Partial<EditableFields>} changes */
function merged(before, changes) {
  return { placement: changes.placement ?? before.placement, eventId: changes.eventId ?? before.eventId };
}

/** @param {any} tx @param {number} id @param {Partial<EditableFields>} changes @param {EditableFields} before */
async function applyPlacement(tx, id, changes, before) {
  if (changes.placement === undefined && changes.eventId === undefined) return;
  const place = merged(before, changes);
  await updatePlacement(tx, { itemId: id, placement: place.placement, eventId: place.placement === 'event' ? place.eventId : null });
}

/** @param {any} tx @param {{ id:number, changes:Partial<EditableFields>, role:string, itemRow:any }} args */
async function applyLookups(tx, { id, changes, role, itemRow }) {
  if (changes.categoryName === undefined && changes.clientName === undefined) return;
  const canCreate = role === 'owner';
  const categoryId = changes.categoryName === undefined ? itemRow.categoryId : await lookupId(tx, changes.categoryName, canCreate, 'categories');
  const clientId = changes.clientName === undefined ? itemRow.clientId : await lookupId(tx, changes.clientName, canCreate, 'clients');
  await updateLookups(tx, { itemId: id, categoryId: categoryId ?? null, clientId: clientId ?? null });
}

/** @param {any} tx @param {{ kind:any, id:number, changes:Partial<EditableFields>, deps:any }} args */
async function applyKindChanges(tx, { kind, id, changes, deps }) {
  if (changes.speakers !== undefined && typeof kind.remapSpeakers === 'function') {
    // Inside the transaction: a query on `deps.db` here would wait for this
    // transaction to end (the connection is already in use).
    const ctx = await loadContext({ db: tx, site: deps.site }, {});
    await kind.remapSpeakers(tx, { itemId: id, map: changes.speakers, ctx });
  }
  if (changes.lineFixes !== undefined && typeof kind.setLineFixes === 'function') {
    await kind.setLineFixes(tx, { itemId: id, fixes: changes.lineFixes });
  }
  if (changes.subbed !== undefined && typeof kind.setSubbed === 'function') {
    await kind.setSubbed(tx, { itemId: id, subbed: changes.subbed === true });
  }
}

/**
 * The item a kind + source id names: any archived state for the owner,
 * visible only for everyone else.
 * @param {any} db @param {{ name: string, platform: string }} kind @param {string} sourceId @param {boolean} allowAnyState
 * @returns {Promise<number|null>}
 */
async function itemIdOf(db, kind, sourceId, allowAnyState) {
  const ref = { kind: kind.name, platform: kind.platform, externalId: sourceId };
  return allowAnyState ? findItemIdBySource(db, ref) : findVisibleItemId(db, ref);
}

/** @param {any} deps @param {string} kindName @param {{ sourceId: string, changes: Partial<EditableFields>, actor: SessionUser }} input */
async function resolveEditInput(deps, kindName, { sourceId, changes, actor }) {
  if (Object.prototype.hasOwnProperty.call(changes, 'text')) throw new BadRequest('the translator\u2019s text cannot be edited');
  const kind = kindNamed(deps, kindName);
  // An unknown kind, like an unknown item, is a 404: the route segment
  // itself is meaningless, not a bad request on an otherwise real one.
  if (!kind) throw new NotFound();
  const id = await itemIdOf(deps.db, kind, sourceId, actor.isOwner === true);
  if (id === null) throw new BadRequest(`no archived ${kindName} item for ${sourceId}`);
  const itemRow = /** @type {any} */ (await getItem(deps.db, id));
  if (!itemRow) throw new BadRequest('item not found');
  const role = canEdit(actor, { createdBy: itemRow.createdBy ?? null, creditedAccountId: itemRow.creditedAccountId ?? null });
  if (!role) throw new Forbidden('forbidden');
  if (Object.keys(changes).length === 0) throw new BadRequest('nothing to change');
  return { kind, id, itemRow, role };
}

/**
 * Applies `changes` (only the keys present) in one transaction under
 * `actor.id`, recording `item_edits {before, after}` for the changed keys.
 * @param {{ db: any, site: import('../site/schema.js').Site, kinds?: Record<string, any> }} deps
 * @param {{ kind: string, sourceId: string, changes: Partial<EditableFields>, actor: SessionUser, reverts?: number|null }} input
 * @returns {Promise<{ editId: number }>}
 */
export async function editItem(deps, { kind: kindName, sourceId, changes, actor, reverts = null }) {
  const { kind, id, itemRow, role } = await resolveEditInput(deps, kindName, { sourceId, changes, actor });

  const tagsBefore = await itemChangeTags(deps.db, id);
  const before = await editableOf(deps.db, kind, id);
  const place = merged(before, changes);
  if (place.placement === 'event') {
    if (place.eventId === null) throw new BadRequest('placement event needs an eventId');
    if (!(await eventExists(deps.db, place.eventId))) throw new BadRequest('unknown event');
  }
  if (changes.lineFixes !== undefined) {
    const parts = /** @type {any} */ ((await kind.loadDetails(deps.db, [id], { includePending: true })).get(id))?.parts ?? [];
    validateFixes(parts, changes.lineFixes);
  }

  const editId = await deps.db.transaction(async (/** @type {any} */ tx) => {
    await applyPlacement(tx, id, changes, before);
    await applyLookups(tx, { id, changes, role, itemRow });
    await applyKindChanges(tx, { kind, id, changes, deps });
    const after = await editableOf(tx, kind, id);
    const changed = diffOf(before, after);
    if (Object.keys(changed.before).length === 0) throw new BadRequest('nothing to change');
    const { rows } = await tx.query(
      'insert into item_edits (item_id, before, after, reverts, created_by) values ($1, $2, $3, $4, $5) returning id',
      [id, JSON.stringify(changed.before), JSON.stringify(changed.after), reverts, actor.id],
    );
    return rows[0].id;
  }, { actor: actor.id });

  // Both the old and the new relationships: moving an entry to another
  // event (or changing its cast) leaves the previous pages stale too.
  const tagsAfter = await itemChangeTags(deps.db, id);
  await purgeForTags(/** @type {any} */ (deps), [...tagsBefore, ...tagsAfter]);
  return { editId: /** @type {number} */ (editId) };
}

/** @param {unknown} err @returns {boolean} whether the database refused a second revert of one edit */
function isRevertConflict(err) {
  const pg = /** @type {any} */ (err);
  return pg?.code === '23505' && String(pg.constraint ?? '').includes('reverts');
}

/**
 * Reverts a recorded edit (owner only): re-applies its `before` through
 * `editItem`, marked as reverting it.
 * @param {{ db: any, site: import('../site/schema.js').Site, kinds?: Record<string, any> }} deps
 * @param {{ kind: string, sourceId: string, editId: number, actor: SessionUser }} input
 * @returns {Promise<{ editId: number }>}
 */
export async function revertEdit(deps, { kind: kindName, sourceId, editId, actor }) {
  const { rows } = await deps.db.query('select item_id, before, reverts from item_edits where id = $1', [editId]);
  if (rows.length === 0) throw new BadRequest('unknown edit');
  // The edit id must belong to the item the URL addresses: otherwise a
  // caller could apply one item's `before` to another item.
  const kind = kindNamed(deps, kindName);
  const itemId = kind ? await itemIdOf(deps.db, kind, sourceId, actor.isOwner === true) : null;
  if (itemId === null || itemId !== rows[0].item_id) throw new BadRequest('unknown edit');
  const already = await deps.db.query('select 1 from item_edits where reverts = $1 limit 1', [editId]);
  if (already.rows.length > 0) throw new Conflict('already reverted');
  const before = /** @type {EditableFields} */ (rows[0].before);
  try {
    return await editItem(deps, { kind: kindName, sourceId, changes: before, actor, reverts: editId });
  } catch (err) {
    // The unique index is the real guard against a race between two reverts;
    // the check above only keeps the common case readable.
    if (isRevertConflict(err)) throw new Conflict('already reverted');
    throw err;
  }
}

/**
 * Resolves the item a route addresses, with the caller's edit role.
 * @param {any} deps @param {string} kindName @param {string} sourceId @param {SessionUser} user
 * @returns {Promise<{ kind: any, id: number, item: any, role: 'submitter'|'translator'|'owner'|null }|null>}
 */
export async function resolveForEdit(deps, kindName, sourceId, user) {
  const kind = kindNamed(deps, kindName);
  if (!kind) return null;
  const id = await itemIdOf(deps.db, kind, sourceId, user.isOwner === true);
  if (id === null) return null;
  const item = /** @type {any} */ (await getItem(deps.db, id));
  if (!item) return null;
  const role = canEdit(user, { createdBy: item.createdBy ?? null, creditedAccountId: item.creditedAccountId ?? null });
  return { kind, id, item, role };
}
