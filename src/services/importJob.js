// @ts-check
/**
 * The import job as the review page sees it (Plan 3): counts, rows with
 * their previews, the per-translator table of unmapped markers, and the
 * readiness classification that decides whether a held entry is ready to
 * publish. Kind-agnostic: kinds come from the registry and are asked for
 * their own details.
 */
import { partLines, unmappedMarkers } from '../domain/lineFixes.js';
import { findMarkers } from '../domain/lines.js';
import { countsByState, createJob, getJob, getRow, insertRows, jobsRecent, rowsForRun, rowsPage as repoRows, rowsWithItems, updateRow } from '../repo/imports.js';
import { kindNamed, kindsOf, presenterContext, previewsForAny } from './cards.js';
import { sourceState } from '../repo/items.js';
import { ingestItem } from './ingest.js';
import { write } from './write.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('../repo/imports.js').RowState} RowState */

/** One page of rows on the review page. */
export const IMPORT_PAGE_SIZE = 50;

/** The owner's user row, so the import's actor is valid on any database. @param {{ db: any, site: { ownerXUserId: string } }} deps */
export async function ensureOwnerUser(deps) {
  const userId = `x:${deps.site.ownerXUserId}`;
  await deps.db.transaction(
    (/** @type {any} */ tx) => tx.query("insert into users (id, role) values ($1, 'owner') on conflict (id) do nothing", [userId]),
    { actor: 'system' },
  );
  return userId;
}

/** @param {string} platform @param {string} externalId */
function sourceUrlOf(platform, externalId) {
  return platform === 'x' ? `https://x.com/i/status/${externalId}` : '';
}

/**
 * The kind and kind-details of the given item ids, batched per kind.
 * @param {ViewDeps} deps @param {{ id: number, kind: string }[]} items
 */
export async function detailsOf(deps, items) {
  /** @type {Map<number, any>} */
  const byId = new Map();
  for (const kindName of new Set(items.map((item) => item.kind))) {
    const kind = kindNamed(deps, kindName);
    if (!kind) continue;
    const ids = items.filter((item) => item.kind === kindName).map((item) => item.id);
    const loaded = await kind.loadDetails(deps.db, ids, { includePending: true });
    for (const [id, details] of loaded) byId.set(id, details);
  }
  return byId;
}

/**
 * @param {ViewDeps} deps @param {any} details
 * @returns {'fetched'|'needs_speakers'|'check'}
 */
export function classifyDetails(deps, details) {
  const lines = partLines(details.parts, details.fixes ?? []);
  const markers = findMarkers(lines);
  const text = String(details.body ?? details.parts.join('\n')).trim();
  if (markers.length === 0) return text.length < 20 ? 'check' : 'fetched';
  const unmapped = unmappedMarkers(details.parts, details.fixes ?? [], details.speakers ?? {});
  return unmapped.length > 0 ? 'needs_speakers' : 'fetched';
}

/**
 * How a held item should be listed: ready, waiting on speakers, or a
 * judgement call. Null when the kind or details are missing.
 * @param {ViewDeps} deps @param {string} kindName @param {number} itemId
 * @returns {Promise<'fetched'|'needs_speakers'|'check'|null>}
 */
export async function readinessOf(deps, kindName, itemId) {
  const kind = kindNamed(deps, kindName);
  if (!kind) return null;
  const details = /** @type {any} */ ((await kind.loadDetails(deps.db, [itemId], { includePending: true })).get(itemId));
  return details ? classifyDetails(deps, details) : null;
}

/**
 * Rewrites a held row's state from its item's readiness. Terminal rows
 * (published, skipped) and rows with no item are left alone.
 * @param {ViewDeps} deps @param {number} rowId
 * @returns {Promise<RowState|null>}
 */
export async function recomputeRow(deps, rowId) {
  const row = await getRow(deps.db, rowId);
  if (!row || row.itemId === null) return null;
  if (!['queued', 'failed', 'fetched', 'needs_speakers', 'check'].includes(row.state)) return row.state;
  const { rows } = await deps.db.query('select kind from items where id = $1', [row.itemId]);
  const kind = rows[0]?.kind;
  const state = kind ? await readinessOf(deps, kind, row.itemId) : null;
  if (!state) return null;
  await deps.db.transaction((tx) => updateRow(tx, row.id, { state }), { actor: 'system' });
  return state;
}

/** @param {any} entry @returns {string} */
function textOf(entry) {
  if (!entry) return '';
  return entry.preview.lines.map((/** @type {any} */ line) => ('text' in line ? line.text : '')).join(' ');
}

/** @param {any} row @param {any} entry @returns {any} */
function rowViewOf(row, entry) {
  return {
    id: row.id, state: row.state, translator: entry?.card.account ?? null,
    event: entry?.card.event ?? null, preview: entry?.preview ?? null,
    itemId: row.itemId, error: row.error, sourceUrl: sourceUrlOf(row.platform, row.externalId),
    externalId: row.externalId, platform: row.platform, text: textOf(entry),
    entryUrl: entry?.preview.url ?? null,
    editUrl: entry ? `/edit/${entry.card.kind}/${entry.card.sourceId}` : null,
  };
}

/**
 * The job's items whose own text matches `q`, through each kind's search
 * clause: the parsed text is not in `import_rows`, so a row search must
 * ask the items before paging (otherwise a match on page 2 never appears).
 * @param {ViewDeps} deps @param {number} jobId @param {string} q
 * @returns {Promise<number[]>}
 */
async function matchingItemIds(deps, jobId, q) {
  const kinds = Object.values(kindsOf(deps));
  /** @type {unknown[]} */
  const params = [`%${q}%`, jobId];
  const clauses = kinds.map((kind) => {
    params.push(kind.name);
    return `(i.kind = $${params.length} and ${kind.search.textClause(1)})`;
  });
  const { rows } = await deps.db.query(
    `select distinct i.id from items i
     where i.id in (select item_id from import_rows where job_id = $2 and item_id is not null)
       and (${clauses.join(' or ')})`,
    params,
  );
  return rows.map((row) => row.id);
}

/**
 * @param {ViewDeps} deps @param {number} jobId
 * @param {{ state?: string, q?: string, offset: number }} page
 * @returns {Promise<{ rows: any[], hasMore: boolean }>}
 */
export async function rowsPage(deps, jobId, page) {
  const q = typeof page.q === 'string' ? page.q.trim() : '';
  const itemIds = q === '' ? undefined : await matchingItemIds(deps, jobId, q);
  const pageOf = await repoRows(deps.db, jobId, { ...page, q, itemIds, limit: IMPORT_PAGE_SIZE });
  const ids = pageOf.rows.map((row) => row.itemId).filter((id) => id !== null);
  const ctx = await presenterContext(deps);
  const entries = ids.length > 0 ? await previewsForAny(deps, ids, ctx) : [];
  const byId = new Map(entries.map((entry) => [entry.card.id, entry]));
  const rows = pageOf.rows.map((row) => rowViewOf(row, row.itemId === null ? undefined : byId.get(row.itemId)));
  return { rows, hasMore: pageOf.hasMore };
}

/**
 * Adds one item's unmapped markers to its translator's group.
 * @param {any} group @param {{ id: number, kind: string }} item @param {any} detail
 * @param {string} sourceId
 */
function addItemMarkers(group, item, detail, sourceId) {
  const unmapped = unmappedMarkers(detail.parts, detail.fixes ?? [], detail.speakers ?? {});
  const lines = partLines(detail.parts, detail.fixes ?? []);
  for (const { marker, count } of unmapped) {
    const entry = group.markers.get(marker) ?? { marker, count: 0, example: '', entries: [] };
    entry.count += count;
    const line = lines.find((candidate) => candidate.kind === 'speech' && candidate.markers.includes(marker));
    if (!entry.example && line) entry.example = line.text.trim();
    entry.entries.push({ itemId: item.id, kind: item.kind, sourceId, text: String(detail.body ?? '').trim() });
    group.markers.set(marker, entry);
  }
}

/**
 * The per-translator marker table: unmapped markers among the job's held
 * items, with a count, one example line, and the entries using them.
 * @param {ViewDeps} deps @param {number} jobId
 */
export async function markerTable(deps, jobId) {
  const rows = await rowsWithItems(deps.db, jobId);
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.itemId);
  const { rows: itemRows } = await deps.db.query(
    `select i.id, i.kind, i.credited_account_id, a.handle from items i
     left join accounts a on a.id = i.credited_account_id where i.id = any($1::bigint[])`,
    [ids],
  );
  const details = await detailsOf(deps, itemRows);
  /** @type {Map<string, any>} */
  const byTranslator = new Map();
  for (const item of itemRows) {
    const detail = details.get(item.id);
    if (!detail) continue;
    const key = String(item.credited_account_id ?? 'none');
    if (!byTranslator.has(key)) {
      byTranslator.set(key, { accountId: item.credited_account_id ?? null, handle: item.handle ?? null, markers: new Map() });
    }
    const sourceId = rows.find((row) => row.itemId === item.id)?.externalId ?? String(item.id);
    addItemMarkers(byTranslator.get(key), item, detail, sourceId);
  }
  return [...byTranslator.values()]
    .map((group) => ({ accountId: group.accountId, handle: group.handle, markers: [...group.markers.values()] }))
    .filter((group) => group.markers.length > 0)
    .sort((a, b) => String(a.handle).localeCompare(String(b.handle)));
}

/**
 * Everything the review page shows for one job.
 * @param {ViewDeps} deps @param {number} jobId
 */
export async function jobView(deps, jobId) {
  const [job, counts, rows, markers] = await Promise.all([
    getJob(deps.db, jobId),
    countsByState(deps.db, jobId),
    rowsPage(deps, jobId, { offset: 0 }),
    markerTable(deps, jobId),
  ]);
  return job ? { job, counts, rows: rows.rows, hasMore: rows.hasMore, markers } : null;
}

/**
 * Ingest one import row with the import's flags and record the outcome.
 * Shared by the CLI and the dev seed so the two cannot drift.
 * @param {ViewDeps & { fetchImpl: typeof fetch }} deps
 * @param {{ row: any, kind: string, actor: string, source: string }} input
 * @returns {Promise<{ state: string, reason: string|null }>}
 */
export async function runRow(deps, { row, kind, actor, source }) {
  const known = await sourceState(deps.db, kind, 'x', row.externalId);
  if (known !== 'none') {
    const reason = known === 'pending' ? 'already archived — awaiting review' : `already archived (${known})`;
    await deps.db.transaction((tx) => updateRow(tx, row.id, { state: 'skipped', error: reason }), { actor: 'system' });
    return { state: 'skipped', reason };
  }
  const result = await ingestItem(deps, {
    kind, input: `https://x.com/i/status/${row.externalId}`, overrides: row.overrides ?? {},
    addedVia: source === 'notion' ? 'notion' : 'paste',
    actor, holdForReview: true, allowUnmapped: true, lookups: 'create',
  });
  return recordResult(deps, row, result);
}

/**
 * The row state, item and error one ingest result records.
 * @param {any} result
 * @returns {{ state: RowState, itemId: number|null, error: string|null }}
 */
function rowResultOf(result) {
  if (result.status === 'added' || result.status === 'pending') return { state: 'fetched', itemId: result.itemId, error: null };
  if (result.status === 'attached') return { state: 'attached', itemId: result.itemId, error: result.pending ? 'held part' : null };
  const skipped = result.status === 'duplicate' || result.status === 'removed' || result.status === 'opted_out';
  return { state: skipped ? 'skipped' : 'failed', itemId: result.itemId ?? null, error: result.status };
}

/**
 * Records one ingest result on its row.
 * @param {import('./write.js').Write} w @param {any} row @param {any} result
 * @returns {Promise<{ state: RowState, reason: string|null }>}
 */
async function setRowResult(w, row, result) {
  const { state, itemId, error } = rowResultOf(result);
  await updateRow(w.tx, row.id, { state, itemId, error });
  return { state, reason: error };
}

/**
 * Applies one ingest result to its row; a fetched row is then classified
 * by its item's readiness.
 * @param {ViewDeps} deps @param {any} row @param {any} result
 * @returns {Promise<{ state: string, reason: string|null }>}
 */
async function recordResult(deps, row, result) {
  const recorded = await write(deps, 'system', (w) => setRowResult(w, row, result));
  if (recorded.state !== 'fetched') return recorded;
  return { state: (await recomputeRow(deps, row.id)) ?? 'fetched', reason: null };
}

/**
 * The five most recent jobs, for the owner's me section.
 * @param {ViewDeps} deps
 */
export async function recentJobs(deps) {
  return jobsRecent(deps.db, { limit: 5 });
}

/**
 * One job's rows page; null when the job is unknown.
 * @param {ViewDeps} deps @param {number} jobId
 * @param {{ state?: string, q?: string, offset: number }} page
 */
export async function rowsPageFor(deps, jobId, page) {
  const job = await getJob(deps.db, jobId);
  return job ? rowsPage(deps, jobId, page) : null;
}

/**
 * Creates a held job from tweet ids and ingests each one (the dev seed).
 * @param {ViewDeps & { fetchImpl: typeof fetch }} deps
 * @param {string[]} ids
 */
export async function seedHeldJob(deps, ids) {
  const jobId = await deps.db.transaction((tx) => createJob(tx, { source: 'notion', actor: 'system' }), { actor: 'system' });
  await deps.db.transaction((tx) => insertRows(tx, jobId, ids.map((externalId) => ({ platform: 'x', externalId, overrides: {} }))), { actor: 'system' });
  const actor = await ensureOwnerUser(deps);
  /** @type {any[]} */
  const rows = [];
  for (const row of await rowsForRun(deps.db, jobId)) {
    rows.push(await runRow(deps, { row, kind: 'translation', actor, source: 'notion' }));
  }
  return { jobId, rows };
}
