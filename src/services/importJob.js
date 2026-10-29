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
import { countsByState, getJob, getRow, rowsPage as repoRows, rowsWithItems, updateRow } from '../repo/imports.js';
import { kindsOf, presenterContext, previewsForAny } from './cards.js';

/** @typedef {import('./cards.js').ViewDeps} ViewDeps */
/** @typedef {import('../repo/imports.js').RowState} RowState */

/** One page of rows on the review page. */
export const IMPORT_PAGE_SIZE = 50;

/** @param {string} platform @param {string} externalId */
function sourceUrlOf(platform, externalId) {
  return platform === 'x' ? `https://x.com/i/status/${externalId}` : '';
}

/**
 * The kind and kind-details of the given item ids, batched per kind.
 * @param {ViewDeps} deps @param {{ id: number, kind: string }[]} items
 */
async function detailsOf(deps, items) {
  /** @type {Map<number, any>} */
  const byId = new Map();
  for (const kindName of new Set(items.map((item) => item.kind))) {
    const kind = kindsOf(deps)[kindName];
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
  const kind = kindsOf(deps)[kindName];
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

/**
 * @param {ViewDeps} deps @param {number} jobId
 * @param {{ state?: string, q?: string, offset: number }} page
 * @returns {Promise<{ rows: any[], hasMore: boolean }>}
 */
export async function rowsPage(deps, jobId, page) {
  const pageOf = await repoRows(deps.db, jobId, { ...page, limit: IMPORT_PAGE_SIZE });
  const ids = pageOf.rows.map((row) => row.itemId).filter((id) => id !== null);
  const ctx = await presenterContext(deps);
  const entries = ids.length > 0 ? await previewsForAny(deps, ids, ctx) : [];
  const byId = new Map(entries.map((entry) => [entry.card.id, entry]));
  const q = typeof page.q === 'string' ? page.q.trim().toLowerCase() : '';
  const rows = pageOf.rows
    .map((row) => {
      const entry = row.itemId === null ? undefined : byId.get(row.itemId);
      const text = entry ? entry.preview.lines.map((line) => ('text' in line ? line.text : '')).join(' ') : '';
      return {
        id: row.id, state: row.state, translator: entry?.card.account ?? null,
        event: entry?.card.event ?? null, preview: entry?.preview ?? null,
        itemId: row.itemId, error: row.error, sourceUrl: sourceUrlOf(row.platform, row.externalId),
        externalId: row.externalId, platform: row.platform, text,
      };
    })
    .filter((row) => q === '' || row.text.toLowerCase().includes(q) || row.externalId.includes(q));
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
