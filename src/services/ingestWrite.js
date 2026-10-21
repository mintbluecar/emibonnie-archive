// @ts-check
/**
 * The write half of ingest, run inside one transaction: the credited
 * account, a proposed event, the category/client, the item, its people,
 * and then the kind's own rows (`kind.persist`). Reads only `draft.common`.
 */
import { upsertAccount } from '../repo/accounts.js';
import { createEvent } from '../repo/events.js';
import { ensureCategory, ensureClient } from '../repo/lookups.js';
import { insertItem } from '../repo/items.js';
import { setItemPeople } from '../repo/itemPeople.js';
import { get as getSetting } from '../repo/settings.js';

/** @typedef {import('../db/common.js').Tx} Tx */
/** @typedef {import('../kinds/defineKind.js').Kind} Kind */
/** @typedef {import('../kinds/defineKind.js').Draft} Draft */
/** @typedef {import('../kinds/defineKind.js').DraftCommon} DraftCommon */
/** @typedef {import('../domain/constants.js').ReviewState} ReviewState */
/**
 * @typedef {{ kind: Readonly<Kind>, draft: Draft, occurredOn: string, addedVia: string, actor: string,
 *   creditedUserId: string|null }} WriteRequest
 */

/** @param {Tx} tx @param {DraftCommon['credited']} credited */
function upsertCredited(tx, credited) {
  const { platform, externalId, handle, displayName } = credited;
  return upsertAccount(tx, {
    platform, externalId: externalId ?? undefined, handle: handle ?? externalId ?? 'unknown', displayName: displayName ?? undefined,
  });
}

/**
 * The matched event's id, or the proposed event (created, or found when
 * another ingest just created the same slug), dated `occurredOn` when the
 * proposal has no date of its own.
 * @param {Tx} tx
 * @param {DraftCommon} common
 * @param {string} occurredOn
 * @returns {Promise<number|null>}
 */
async function eventIdOf(tx, common, occurredOn) {
  if (!common.proposal) return common.eventId;
  const event = await createEvent(tx, { ...common.proposal, occurredOn: common.proposal.occurredOn ?? occurredOn });
  return event.id;
}

/**
 * Hand-typed text waits for review unless the credited account's own user
 * typed it; everything else follows `settings.approvalRequired`.
 * @param {Tx} tx
 * @param {{ common: DraftCommon, actor: string, creditedUserId: string|null }} input
 * @returns {Promise<ReviewState>}
 */
async function reviewStateOf(tx, { common, actor, creditedUserId }) {
  if (common.textEnteredManually && creditedUserId !== actor) return 'pending';
  return (await getSetting(tx, 'approvalRequired')) === true ? 'pending' : 'published';
}

/** @param {string} isoDate */
function epochOf(isoDate) {
  return Date.parse(`${isoDate}T00:00:00Z`) / 1000;
}

/**
 * @param {Tx} tx
 * @param {WriteRequest} request
 * @returns {Promise<{ itemId: number, eventId: number|null, reviewState: ReviewState }>}
 */
export async function writeItem(tx, { kind, draft, occurredOn, addedVia, actor, creditedUserId }) {
  const { common } = draft;
  const accountId = await upsertCredited(tx, common.credited);
  const eventId = await eventIdOf(tx, common, occurredOn);
  const categoryId = common.categoryName ? await ensureCategory(tx, common.categoryName) : null;
  const clientId = common.clientName ? await ensureClient(tx, common.clientName) : null;
  const reviewState = await reviewStateOf(tx, { common, actor, creditedUserId });
  const itemId = await insertItem(tx, {
    kind: kind.name, placement: common.placement, eventId, categoryId, clientId, creditedAccountId: accountId,
    occurredOn, postedAt: common.postedAt, addedVia, reviewState, sortKey: common.postedAt ? null : epochOf(occurredOn),
  });
  await setItemPeople(tx, itemId, common.people);
  await kind.persist(tx, draft, { itemId, accountId });
  return { itemId, eventId, reviewState };
}
