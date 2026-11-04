// @ts-check
/**
 * Shared setup for the event admin service tests: a seeded database with
 * a signed-in owner, events made through `createEvent` (so their tags and
 * live people are real rows), entries in them, and a purge recorder.
 */
import { seededDeps } from './ingest.js';
import { insertItem } from './seed.js';
import { createEvent } from '../../src/repo/events.js';
import { signInUser } from '../../src/services/session.js';

/** @typedef {import('../../src/services/eventFields.js').EventFields} EventFields */

/**
 * The seeded deps plus the owner, and helpers bound to that database.
 * Purges are recorded in `purged` (tags invalidated) and `deleted` (tags
 * deleted outright), as the CDN would receive them.
 */
export async function eventAdminSetup() {
  const purged = /** @type {string[]} */ ([]);
  const deleted = /** @type {string[]} */ ([]);
  const base = await seededDeps();
  const deps = {
    ...base,
    env: { VERCEL: '1' },
    invalidateByTag: async (/** @type {string[]} */ tags) => { purged.push(...tags); },
    dangerouslyDeleteByTag: async (/** @type {string[]} */ tags) => { deleted.push(...tags); },
  };
  const signIn = { db: base.db, site: base.site, now: () => new Date() };
  const owner = (await signInUser(signIn, { via: 'x', subject: base.site.ownerXUserId, handle: 'owner' })).user;
  /** @param {(tx: any) => Promise<any>} fn */
  const inTx = (fn) => base.db.transaction(fn, { actor: 'system' });
  return {
    deps, owner, purged, deleted, inTx,
    /** @param {string} slug @param {Partial<import('../../src/domain/events.js').EventProposal>} [fields] @returns {Promise<number>} */
    makeEvent: async (slug, fields = {}) => (await inTx((tx) => createEvent(tx, {
      name: 'Event', slug, addressTag: 'event', occurredOn: slug.slice(0, 10),
      keywords: [], hashtags: [], livePeopleIds: [], livePlatformCode: null, ...fields,
    }))).id,
    /** A pending entry (so the event stays unlocked) unless `reviewState` says otherwise. @param {number} eventId @param {{ reviewState?: string }} [options] @returns {Promise<number>} */
    makeItem: (eventId, { reviewState = 'pending' } = {}) =>
      inTx((tx) => insertItem(tx, { placement: 'event', eventId, reviewState })),
    /** @param {number} eventId */
    eventRow: async (eventId) => (await base.db.query('select * from events where id = $1', [eventId])).rows[0],
    /** @param {number[]} itemIds @returns {Promise<(number|null)[]>} each item's event_id, in order */
    eventIdsOf: async (itemIds) => {
      const { rows } = await base.db.query('select id, event_id from items where id = any($1::bigint[])', [itemIds]);
      const byId = new Map(rows.map((row) => [row.id, row.event_id]));
      return itemIds.map((id) => byId.get(id) ?? null);
    },
    /** @param {number} itemId */
    editsOf: async (itemId) => (await base.db.query(
      'select before, after, reverts, created_by from item_edits where item_id = $1 order by id', [itemId],
    )).rows,
  };
}

/** @param {Partial<EventFields>} [overrides] @returns {EventFields} */
export function fieldsOf(overrides = {}) {
  return {
    name: 'An event', occurredOn: '2032-01-01', keywords: [], hashtags: [],
    livePeopleIds: [], livePlatformCode: null, addressTag: 'tag', ...overrides,
  };
}
