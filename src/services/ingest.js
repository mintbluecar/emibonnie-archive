// @ts-check
/**
 * The single write path every intake uses (CLI, submit form, bulk
 * import). Generic: it never names a kind -- the kind comes from the
 * registry -- and reads only `draft.common` and `draft.missing`.
 *
 * Steps, each a small function below:
 *   1. the pasted id is already archived: duplicate / removed / pending,
 *      or `attached` when it is some item's follow-up;
 *   2. the kind fetches the source: deleted / unavailable;
 *   3. draft once (no memory yet) to learn the credited account and the
 *      canonical id: duplicate again (an edited post's other version), or
 *      opted_out;
 *   4. a same-author continuation of an archived item is attached to it;
 *   5. redraft with the account's speaker memory: needs_speakers, needs_date;
 *   6. write everything in one transaction: added, or pending.
 */
import { kindsRegistry } from '../kinds/_registry.js';
import { BadRequest } from '../sources/errors.js';
import { findSourceOwner } from '../repo/itemSources.js';
import { accountState } from '../repo/accounts.js';
import { recall } from '../repo/speakerMemory.js';
import { loadContext, occurredOnOf } from './ingestContext.js';
import { writeItem } from './ingestWrite.js';

/** @typedef {import('../kinds/defineKind.js').Kind} Kind */
/** @typedef {import('../kinds/defineKind.js').Draft} Draft */
/** @typedef {import('../kinds/defineKind.js').DraftOverrides} DraftOverrides */
/** @typedef {import('../kinds/defineKind.js').DraftContext} DraftContext */
/** @typedef {import('../kinds/defineKind.js').SourceRef} SourceRef */
/** @typedef {import('../domain/speakers.js').SpeakerMap} SpeakerMap */
/**
 * @typedef {{ db: import('../db/common.js').Db, site: import('../site/schema.js').Site, fetchImpl: typeof fetch,
 *   now?: () => Date, kinds?: Record<string, Readonly<Kind>> }} IngestDeps
 *   `kinds` replaces the registry (tests inject a failing kind).
 * @typedef {{ kind: string, input: string, chosen?: SpeakerMap, overrides?: DraftOverrides, addedVia: string,
 *   actor: string }} IngestRequest
 * @typedef {{ status: 'added'|'attached'|'pending'|'duplicate'|'removed'|'opted_out'|'deleted'|'unavailable'
 *     |'needs_speakers'|'needs_date',
 *   sourceId: string, itemId?: number, eventId?: number|null, missing?: object[], draft?: object }} IngestResult
 * @typedef {{ deps: IngestDeps, request: IngestRequest, kind: Readonly<Kind>, sourceId: string }} Run
 */

/** @type {Record<'visible'|'removed'|'pending', IngestResult['status']>} */
const STATE_STATUS = { visible: 'duplicate', removed: 'removed', pending: 'pending' };

/** @param {IngestDeps} deps @param {string} name */
function kindNamed(deps, name) {
  const kind = (deps.kinds ?? kindsRegistry)[name];
  if (!kind) throw new BadRequest(`unknown kind: ${name}`);
  return kind;
}

/**
 * Step 1 (and 3's re-check): what's already archived under `ref`, read in
 * one query so the state and the item id come from the same item.
 * @param {Run} run
 * @param {SourceRef} ref
 * @returns {Promise<IngestResult|null>}
 */
async function knownSource({ deps, kind, sourceId }, ref) {
  const owner = await findSourceOwner(deps.db, { kind: kind.name, platform: ref.platform, externalId: ref.externalId });
  if (!owner) return null;
  const status = owner.state === 'visible' && owner.role === 'follow_up' ? 'attached' : STATE_STATUS[owner.state];
  return { status, sourceId, itemId: owner.itemId };
}

/**
 * Step 4: the input continues an archived item by the same credited
 * account, so it becomes that item's next part. A hidden owner (removed or
 * awaiting review) is reported as such, and nothing is written: a removed
 * translation must not come back through a reply.
 * @param {Run} run
 * @param {{ input: any, credited: Draft['common']['credited'], accountId: number|null }} found
 * @returns {Promise<IngestResult|null>}
 */
async function attachIfFollowUp({ deps, request, kind, sourceId }, { input, credited, accountId }) {
  const parent = kind.followUpOf?.(input);
  if (!parent || !kind.appendFollowUp || !credited.externalId) return null;
  const owner = await findSourceOwner(deps.db, { kind: kind.name, ...parent });
  if (!owner || owner.accountExternalId !== credited.externalId) return null;
  if (owner.state !== 'visible') return { status: STATE_STATUS[owner.state], sourceId, itemId: owner.itemId };
  const append = /** @type {NonNullable<Kind['appendFollowUp']>} */ (kind.appendFollowUp);
  await deps.db.transaction((tx) => append(tx, { itemId: owner.itemId, accountId, input }), { actor: request.actor });
  return { status: 'attached', sourceId, itemId: owner.itemId };
}

/**
 * Step 5's checks on the final draft.
 * @param {Run} run
 * @param {Draft} draft
 * @returns {{ refusal: IngestResult|null, occurredOn: string|null }}
 */
function readiness({ deps, request, sourceId }, draft) {
  if (draft.missing.length > 0) return { refusal: { status: 'needs_speakers', sourceId, missing: draft.missing, draft }, occurredOn: null };
  const occurredOn = occurredOnOf(draft.common, request.overrides, deps.site.timezone);
  if (!occurredOn) return { refusal: { status: 'needs_date', sourceId, draft }, occurredOn: null };
  return { refusal: null, occurredOn };
}

/** @param {any} err */
function isPrimaryRace(err) {
  return err?.code === '23505' && String(err.constraint ?? err.message).includes('item_sources_primary_per_kind');
}

/**
 * Step 6. Another ingest of the same post may commit between step 1 and
 * this write; the primary-source unique index then rejects this one, and
 * the winner is reported as a duplicate.
 * @param {Run} run
 * @param {{ draft: Draft, occurredOn: string, creditedUserId: string|null }} ready
 * @returns {Promise<IngestResult>}
 */
async function write(run, { draft, occurredOn, creditedUserId }) {
  const { deps, request, kind, sourceId } = run;
  const { actor, addedVia } = request;
  try {
    const written = await deps.db.transaction(
      (tx) => writeItem(tx, { kind, draft, occurredOn, addedVia, actor, creditedUserId }),
      { actor },
    );
    const status = written.reviewState === 'pending' ? 'pending' : 'added';
    return { status, sourceId, itemId: written.itemId, eventId: written.eventId };
  } catch (err) {
    const winner = isPrimaryRace(err) ? await knownSource(run, draft.common.primary) : null;
    if (!winner) throw err;
    return { status: 'duplicate', sourceId, itemId: winner.itemId };
  }
}

/**
 * Steps 2-3: fetch and a first draft, refusing a gone source, another
 * version of an archived one, or an opted-out account.
 * @param {Run} run
 * @returns {Promise<{ refusal: IngestResult } | { refusal: null, input: any, ctx: DraftContext, first: Draft,
 *   account: Awaited<ReturnType<typeof accountState>> }>}
 */
async function screen(run) {
  const { deps, request, kind, sourceId } = run;
  const input = await kind.fetchSource(deps, sourceId);
  if (input.status !== 'live') return { refusal: { status: input.status, sourceId } };
  const ctx = await loadContext(deps, request);
  const first = kind.draft(input, ctx);
  const { credited, primary } = first.common;
  const canonical = primary.externalId !== sourceId ? await knownSource(run, primary) : null;
  if (canonical) return { refusal: canonical };
  const account = await accountState(deps.db, credited);
  if (account?.optedOut) return { refusal: { status: 'opted_out', sourceId } };
  return { refusal: null, input, ctx, first, account };
}

/**
 * Steps 2-6, once the pasted id is known to be new.
 * @param {Run} run
 * @returns {Promise<IngestResult>}
 */
async function ingestNew(run) {
  const screened = await screen(run);
  if (screened.refusal) return screened.refusal;
  const { input, ctx, first, account } = screened;
  const accountId = account?.id ?? null;
  const attached = await attachIfFollowUp(run, { input, credited: first.common.credited, accountId });
  if (attached) return attached;

  const draft = accountId === null ? first : run.kind.draft(input, { ...ctx, remembered: await recall(run.deps.db, accountId) });
  const { refusal, occurredOn } = readiness(run, draft);
  if (refusal || !occurredOn) return /** @type {IngestResult} */ (refusal);
  return write(run, { draft, occurredOn, creditedUserId: account?.userId ?? null });
}

/**
 * @param {IngestDeps} deps
 * @param {IngestRequest} request
 * @returns {Promise<IngestResult>}
 */
export async function ingestItem(deps, request) {
  const kind = kindNamed(deps, request.kind);
  const sourceId = kind.matchesUrl(request.input);
  if (!sourceId) throw new BadRequest(`not a ${kind.name} source: ${request.input}`);
  const run = { deps, request, kind, sourceId };
  return (await knownSource(run, { platform: kind.platform, externalId: sourceId })) ?? ingestNew(run);
}
