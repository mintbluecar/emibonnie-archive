// @ts-check
/**
 * The owner's tools until Plan 3's admin (Plan 2b): the approval switch,
 * the waiting list and reviewing held entries. The owner section of the
 * me page reads `ownerView`; every route behind it is owner-only.
 */
import { BadRequest, Conflict, NotFound } from '../domain/errors.js';
import { pendingItemIds, findItemIdBySource, restoreItem } from '../repo/itemState.js';
import { importHeldItemIdSet } from '../repo/imports.js';
import { listVisibleItemIds } from '../repo/items.js';
import { hideEvent } from '../repo/events.js';
import { get as settingsGet, set as settingsSet } from '../repo/settings.js';
import { eventTag, HOME_TAG, SEARCH_TAG } from '../domain/cacheTags.js';
import { kindNamed, kindsOf, presenterContext, previewsForAny } from './cards.js';
import { write } from './write.js';
import { publish, reject, remove } from './itemLifecycle.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('./session.js').SessionUser} SessionUser */
/** @typedef {import('../http/contracts.js').OwnerView} OwnerView */
/** @typedef {import('../domain/constants.js').ReviewState} ReviewState */

/** How many held entries the waiting list shows. */
export const WAITING_LIMIT = 50;

/**
 * Everything the owner section shows in one request: the switch, the X
 * sign-in failure note, the held entries and (Task 9) the report queue.
 * @param {ViewDeps} deps
 * @returns {Promise<OwnerView>}
 */
export async function ownerView(deps) {
  const [approvalRequired, signInFailedAt, ids] = await Promise.all([
    settingsGet(deps.db, 'approvalRequired').then((value) => value === true),
    settingsGet(deps.db, 'xSignInFailedAt'),
    waitingIds(deps),
  ]);
  const ctx = await presenterContext(deps);
  const entries = await previewsForAny(deps, ids, ctx);
  return {
    approvalRequired,
    signInFailedAt: typeof signInFailedAt === 'string' ? signInFailedAt : null,
    waiting: entries.map(({ card, preview }) => ({ ...preview, reviewState: card.reviewState })),
    reports: await reportQueue(deps),
  };
}

/**
 * Held entries: the items whose own review state is pending, plus any item
 * with a held follow-up part (each kind's `heldItemIds`), oldest first.
 * @param {ViewDeps} deps
 * @returns {Promise<number[]>}
 */
async function waitingIds(deps) {
  const kinds = Object.values(kindsOf(deps)).filter((kind) => typeof kind.heldItemIds === 'function');
  // Items an import job is holding are reviewed on the import page, not here:
  // excluded in the query, so the import never consumes the 50-row window.
  const imported = await importHeldItemIdSet(deps.db);
  const [items, ...held] = await Promise.all([
    pendingItemIds(deps.db, { limit: WAITING_LIMIT, exclude: [...imported] }),
    ...kinds.map((kind) => /** @type {NonNullable<typeof kind.heldItemIds>} */ (kind.heldItemIds)(deps.db, { limit: WAITING_LIMIT })),
  ]);
  return [...new Set([...items, ...held.flat()])].filter((id) => !imported.has(id)).sort((a, b) => a - b).slice(0, WAITING_LIMIT);
}

/**
 * Turns the approval switch on or off. Idempotent; audited as a setting.
 * @param {{ db: import('../db/common.js').Db }} deps
 * @param {boolean} required
 * @param {string} actor
 * @returns {Promise<{ approvalRequired: boolean }>}
 */
export async function setApproval(deps, required, actor) {
  const value = required === true;
  await deps.db.transaction((tx) => settingsSet(tx, 'approvalRequired', value), { actor });
  return { approvalRequired: value };
}

/**
 * Publishes or rejects one held (or live) entry. A rejected entry leaves
 * the public surfaces through the existing visibility rule and stays in
 * its submitter's "added by me" list. Both outcomes purge the entry.
 * @param {ViewDeps & { env?: Record<string, string|undefined> }} deps
 * @param {{ kind: string, sourceId: string, state: ReviewState, actor: SessionUser }} input
 * @returns {Promise<{ state: ReviewState }>}
 */
export async function reviewItem(deps, { kind: kindName, sourceId, state, actor }) {
  if (state !== 'published' && state !== 'rejected') throw new BadRequest('state must be published or rejected');
  const kind = kindNamed(deps, kindName);
  if (!kind) throw new BadRequest(`unknown kind: ${kindName}`);
  const id = await findItemIdBySource(deps.db, { kind: kind.name, platform: kind.platform, externalId: sourceId });
  if (id === null) throw new BadRequest(`unknown item: ${sourceId}`);
  // A held follow-up part is reviewed by the same approve/reject.
  const change = state === 'published' ? publish : reject;
  await write(deps, actor.id, (w) => change(w, { itemId: id, kindName: kind.name }));
  return { state };
}

/** How many open reports the owner sees at once. */
export const REPORT_LIMIT = 50;

/**
 * The report's reporter in public form: a handle, a chosen name, or
 * "a fan" (also for the engine's own `system` writes and a deleted user).
 * @param {import('../db/common.js').Db} db @param {string|null} userId
 * @returns {Promise<import('../http/contracts.js').AddedByVM|null>}
 */
async function reporterOf(db, userId) {
  if (userId === null || userId === 'system') return null;
  const { rows } = await db.query(
    `select u.display_name, u.deleted_at,
       (select a.handle from accounts a where a.user_id = u.id and a.platform = 'x' and a.opted_out_at is null
          and a.deleted_at is null order by a.id limit 1) as handle
     from users u where u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (!row || row.deleted_at !== null) return { kind: 'fan' };
  if (row.handle) return { kind: 'handle', handle: row.handle };
  const name = String(row.display_name ?? '').trim();
  return name ? { kind: 'name', name } : { kind: 'fan' };
}

/**
 * The open reports, newest first, each with a link back to what it names.
 * A target that is already gone still appears, `hidden: true` and no link.
 * @param {ViewDeps} deps
 * @returns {Promise<import('../http/contracts.js').ReportVM[]>}
 */
export async function reportQueue(deps) {
  const { rows } = await deps.db.query(
    'select id, target_table, target_id, reason, status, created_by, created_at from reports where status = $1 order by id desc limit $2',
    ['open', REPORT_LIMIT],
  );
  const reports = rows.map((row) => ({
    ...row, reporter: null,
    target: { type: row.target_table === 'events' ? 'event' : 'item', url: '', label: '', hidden: true, restorable: false },
  }));
  const reporters = await Promise.all(reports.map((report) => reporterOf(deps.db, report.created_by)));
  await attachItemTargets(deps, reports);
  await attachEventTargets(deps, reports);
  return reports.map((report, i) => ({
    id: report.id,
    at: new Date(report.created_at).toISOString(),
    reason: report.reason,
    status: report.status,
    reporter: reporters[i],
    target: report.target,
  }));
}

/** @param {ViewDeps} deps @param {any[]} reports */
async function attachItemTargets(deps, reports) {
  const items = reports.filter((report) => report.target_table === 'items');
  if (items.length === 0) return;
  const ids = items.map((report) => Number(report.target_id));
  const ctx = await presenterContext(deps);
  const [entries, states] = await Promise.all([
    previewsForAny(deps, ids, ctx),
    deps.db.query('select id, deleted_at, deleted_reason from items where id = any($1::bigint[])', [ids]),
  ]);
  const previews = new Map(entries.map((entry) => [entry.card.id, entry]));
  const deleted = new Map(states.rows.map((row) => [row.id, { hidden: row.deleted_at !== null, restorable: row.deleted_reason === 'hidden_by_owner' }]));
  for (const report of items) {
    const id = Number(report.target_id);
    const entry = previews.get(id);
    if (!entry) continue;
    const line = entry.preview.lines.find((l) => 'text' in l && l.text.trim() !== '');
    report.target = {
      type: 'item',
      url: entry.preview.url,
      label: line && 'text' in line ? line.text.trim() : entry.card.sourceId,
      hidden: deleted.get(id)?.hidden === true,
      restorable: deleted.get(id)?.restorable === true,
    };
  }
}

/** @param {ViewDeps} deps @param {any[]} reports */
async function attachEventTargets(deps, reports) {
  const events = reports.filter((report) => report.target_table === 'events');
  if (events.length === 0) return;
  const ids = events.map((report) => Number(report.target_id));
  const { rows } = await deps.db.query('select id, slug, name, deleted_at from events where id = any($1::bigint[])', [ids]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const report of events) {
    const event = byId.get(Number(report.target_id));
    if (!event) continue;
    report.target = {
      type: 'event', url: `/e/${event.slug}`, label: event.name,
      hidden: event.deleted_at !== null, restorable: event.deleted_at !== null,
    };
  }
}

/** @param {import('../db/common.js').Db} db @param {number} reportId @returns {Promise<any>} */
async function openReportOf(db, reportId) {
  const { rows } = await db.query('select id, target_table, target_id, status from reports where id = $1', [reportId]);
  if (!rows[0]) throw new NotFound();
  if (rows[0].status !== 'open') throw new Conflict('not_open');
  return rows[0];
}

/**
 * Hides what a report names and leaves the report open, so its row can
 * offer "restore" (the owner's undo for a hide).
 * @param {ViewDeps & { env?: Record<string, string|undefined> }} deps
 * @param {{ reportId: number, actor: SessionUser }} input
 * @returns {Promise<{ hidden: boolean }>}
 */
export async function hideReportTarget(deps, { reportId, actor }) {
  const report = await openReportOf(deps.db, reportId);
  if (report.target_table === 'items') {
    await write(deps, actor.id, (w) => remove(w, { itemId: Number(report.target_id), reason: 'hidden_by_owner' }));
    return { hidden: true };
  }
  const eventId = Number(report.target_id);
  const itemIds = (await listVisibleItemIds(deps.db, { eventId })).map((item) => item.id);
  const { rows } = await deps.db.query('select slug from events where id = $1', [eventId]);
  // Hide the event only: its items keep their placement and come back with it.
  await write(deps, actor.id, async (w) => {
    await hideEvent(w.tx, eventId);
    if (rows[0]) w.purge.tags([HOME_TAG, SEARCH_TAG, eventTag(rows[0].slug)]);
    for (const itemId of itemIds) w.purge.itemRemoved(itemId);
  });
  return { hidden: true };
}

/**
 * Undoes a hide: an item with `hidden_by_owner`, or a soft-deleted event.
 * @param {ViewDeps & { env?: Record<string, string|undefined> }} deps
 * @param {{ reportId: number, actor: SessionUser }} input
 * @returns {Promise<{ restored: boolean }>}
 */
export async function restoreReportTarget(deps, { reportId, actor }) {
  const report = await openReportOf(deps.db, reportId);
  if (report.target_table === 'items') {
    const itemId = Number(report.target_id);
    await write(deps, actor.id, async (w) => {
      if (!(await restoreItem(w.tx, { itemId, reason: 'hidden_by_owner' }))) throw new Conflict('not_hidden');
      w.purge.item(itemId);
    });
    return { restored: true };
  }
  const eventId = Number(report.target_id);
  await write(deps, actor.id, async (w) => {
    const { rows } = await w.tx.query(
      'update events set deleted_at = null where id = $1 and deleted_at is not null returning slug',
      [eventId],
    );
    if (!rows[0]) throw new Conflict('not_hidden');
    w.purge.tags([HOME_TAG, SEARCH_TAG, eventTag(rows[0].slug)]);
  });
  return { restored: true };
}

/**
 * Closes a report without touching what it names.
 * @param {{ db: import('../db/common.js').Db }} deps
 * @param {{ reportId: number, actor: SessionUser }} input
 * @returns {Promise<{ dismissed: boolean }>}
 */
export async function dismissReport(deps, { reportId, actor }) {
  await openReportOf(deps.db, reportId);
  await deps.db.transaction(
    (tx) => tx.query("update reports set status = 'dismissed' where id = $1", [reportId]),
    { actor: actor.id },
  );
  return { dismissed: true };
}
