// @ts-check
/**
 * Public reports (Plan 2b). Anyone, signed in or not, reports an item or
 * an event with a reason of at most 2,000 characters. The target must be
 * publicly visible right now: a hidden or unknown one is a 404, so the
 * form cannot be used to probe for removed content. The report lands in
 * `reports` with status `open` for the owner's queue (Task 9).
 */
import { BadRequest, NotFound } from '../domain/errors.js';
import { findVisibleItemId } from '../repo/cards.js';
import { getVisibleEventBySlug } from '../repo/events.js';
import { kindsOf } from './cards.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('./session.js').SessionUser} SessionUser */
/** @typedef {import('../http/contracts.js').ReportTarget} ReportTarget */

const MAX_REASON = 2000;

/**
 * A visible item target.
 * @param {ViewDeps} deps @param {any} target
 * @returns {Promise<{ table: 'items', id: number }>}
 */
async function itemTarget(deps, target) {
  const kinds = kindsOf(deps);
  const kind = Object.hasOwn(kinds, String(target?.kind ?? '')) ? kinds[target.kind] : undefined;
  if (!kind || typeof target.sourceId !== 'string') throw new BadRequest('unknown target');
  const id = await findVisibleItemId(deps.db, { kind: kind.name, platform: kind.platform, externalId: target.sourceId });
  if (id === null) throw new NotFound();
  return { table: 'items', id };
}

/**
 * A visible event target.
 * @param {ViewDeps} deps @param {any} target
 * @returns {Promise<{ table: 'events', id: number }>}
 */
async function eventTarget(deps, target) {
  if (typeof target?.slug !== 'string') throw new BadRequest('unknown target');
  const event = await getVisibleEventBySlug(deps.db, target.slug);
  if (!event) throw new NotFound();
  return { table: 'events', id: event.id };
}

/**
 * The table and id a target names, only while it is publicly visible.
 * @param {ViewDeps} deps @param {any} target
 * @returns {Promise<{ table: 'items'|'events', id: number }>}
 */
async function resolveTarget(deps, target) {
  if (target?.type === 'item') return itemTarget(deps, target);
  if (target?.type === 'event') return eventTarget(deps, target);
  throw new BadRequest('unknown target');
}

/**
 * Stores one report. `reporter` is recorded when signed in; a signed-out
 * report has no creator.
 * @param {ViewDeps} deps
 * @param {{ target: ReportTarget, reason: unknown, reporter: SessionUser|null }} input
 * @returns {Promise<{ id: number }>}
 */
export async function createReport(deps, { target, reason, reporter }) {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length === 0 || text.length > MAX_REASON) throw new BadRequest(`reason must be 1-${MAX_REASON} characters`);
  const resolved = await resolveTarget(deps, target);
  const actor = reporter?.id ?? 'system';
  const { rows } = await deps.db.transaction(
    (tx) => tx.query(
      'insert into reports (target_table, target_id, reason, created_by) values ($1, $2, $3, $4) returning id',
      [resolved.table, resolved.id, text, reporter?.id ?? null],
    ),
    { actor },
  );
  return { id: rows[0].id };
}
