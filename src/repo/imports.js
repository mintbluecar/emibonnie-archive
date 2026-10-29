// @ts-check
/**
 * import jobs and rows (Plan 3): the CLI writes them, the review page
 * reads and moves them. The tables are from 001; 005 adds the `attached`
 * row state and the job/state index. Every state change is a repo call so
 * the two writers can't drift.
 */
/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[], rowCount?: number }> }} Tx */
/** @typedef {'queued'|'fetched'|'needs_speakers'|'check'|'published'|'skipped'|'failed'|'attached'} RowState */

/** Rows whose item (or held part) is still waiting on the owner. */
export const HELD_STATES = Object.freeze(['fetched', 'needs_speakers', 'check', 'attached']);
/** Held rows that own a whole item (an attached row owns only a part of a published one). */
export const ITEM_HELD_STATES = Object.freeze(['fetched', 'needs_speakers', 'check']);
/** Every state, in the order the page lists them. */
export const ALL_STATES = Object.freeze(['queued', 'fetched', 'needs_speakers', 'check', 'attached', 'published', 'skipped', 'failed']);

const ROW_COLUMNS = 'id, job_id, platform, external_id, overrides, state, item_id, error';

/** @param {any} row */
function toRow(row) {
  return {
    id: row.id, jobId: row.job_id, platform: row.platform, externalId: row.external_id,
    overrides: row.overrides ?? {}, state: row.state, itemId: row.item_id ?? null, error: row.error ?? null,
  };
}

/**
 * @param {Tx} tx
 * @param {{ source: 'notion'|'paste'|'telegram', actor: string }} input
 * @returns {Promise<number>}
 */
export async function createJob(tx, { source, actor }) {
  const { rows } = await tx.query(
    'insert into import_jobs (source, status, created_by) values ($1, $2, $3) returning id',
    [source, 'queued', actor],
  );
  return rows[0].id;
}

/**
 * Adds source rows, ignoring ones this job already holds.
 * @param {Tx} tx
 * @param {number} jobId
 * @param {{ platform: string, externalId: string, overrides: Record<string, unknown> }[]} input
 * @returns {Promise<number>} how many were inserted
 */
export async function insertRows(tx, jobId, input) {
  let inserted = 0;
  for (const row of input) {
    const { rowCount } = await tx.query(
      `insert into import_rows (job_id, platform, external_id, overrides, state)
       values ($1, $2, $3, $4::jsonb, 'queued')
       on conflict (job_id, platform, external_id) do nothing`,
      [jobId, row.platform, row.externalId, JSON.stringify(row.overrides ?? {})],
    );
    inserted += rowCount ?? 0;
  }
  return inserted;
}

/**
 * @param {Tx} db @param {number} jobId
 * @returns {Promise<{ id: number, source: string, status: string, createdAt: string, meta: any }|null>}
 */
export async function getJob(db, jobId) {
  const { rows } = await db.query('select id, source, status, created_at, meta from import_jobs where id = $1', [jobId]);
  const row = rows[0];
  return row
    ? { id: row.id, source: row.source, status: row.status, createdAt: new Date(row.created_at).toISOString(), meta: row.meta ?? {} }
    : null;
}

/** @param {Tx} tx @param {number} jobId @param {'queued'|'running'|'done'|'failed'} status */
export async function setJobStatus(tx, jobId, status) {
  await tx.query('update import_jobs set status = $2 where id = $1 and status <> $2', [jobId, status]);
}

/**
 * @param {Tx} tx @param {number} rowId
 * @param {{ state: RowState, itemId?: number|null, error?: string|null }} input
 */
export async function updateRow(tx, rowId, { state, itemId, error }) {
  const sets = ['state = $2'];
  /** @type {unknown[]} */
  const params = [rowId, state];
  if (itemId !== undefined) {
    params.push(itemId);
    sets.push(`item_id = $${params.length}`);
  }
  if (error !== undefined) {
    params.push(error);
    sets.push(`error = $${params.length}`);
  }
  await tx.query(`update import_rows set ${sets.join(', ')} where id = $1`, params);
}

/**
 * @param {Tx} db @param {number} rowId
 * @returns {Promise<{ id: number, jobId: number, platform: string, externalId: string,
 *   overrides: any, state: RowState, itemId: number|null, error: string|null }|null>}
 */
export async function getRow(db, rowId) {
  const { rows } = await db.query(`select ${ROW_COLUMNS} from import_rows where id = $1`, [rowId]);
  return rows[0] ? toRow(rows[0]) : null;
}

/**
 * @param {Tx} db @param {number} jobId
 * @param {{ state?: string, q?: string, offset: number, limit: number }} page
 * @returns {Promise<{ rows: ReturnType<typeof toRow>[], hasMore: boolean }>}
 */
export async function rowsPage(db, jobId, { state, q, offset, limit }) {
  const conditions = ['job_id = $1'];
  /** @type {unknown[]} */
  const params = [jobId];
  if (state) {
    params.push(state);
    conditions.push(`state = $${params.length}`);
  }
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    conditions.push(`(lower(external_id) like $${params.length} or lower(overrides::text) like $${params.length})`);
  }
  params.push(limit + 1, offset);
  const { rows } = await db.query(
    `select ${ROW_COLUMNS} from import_rows where ${conditions.join(' and ')}
     order by id desc limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return { rows: rows.slice(0, limit).map(toRow), hasMore: rows.length > limit };
}

/**
 * Counts per state, every state present.
 * @param {Tx} db @param {number} jobId
 * @returns {Promise<Record<string, number>>}
 */
export async function countsByState(db, jobId) {
  const { rows } = await db.query('select state, count(*)::int as n from import_rows where job_id = $1 group by state', [jobId]);
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(ALL_STATES.map((state) => [state, 0]));
  for (const row of rows) counts[row.state] = row.n;
  return counts;
}

/**
 * Distinct items a job is still holding (for mapping and publishing).
 * @param {Tx} db @param {number} jobId
 * @returns {Promise<number[]>}
 */
export async function heldItemIds(db, jobId) {
  const { rows } = await db.query(
    'select distinct item_id from import_rows where job_id = $1 and state = any($2::text[]) and item_id is not null order by item_id',
    [jobId, HELD_STATES],
  );
  return rows.map((row) => row.item_id);
}

/**
 * The job's held rows that have an item, for the marker table.
 * @param {Tx} db @param {number} jobId
 * @returns {Promise<ReturnType<typeof toRow>[]>}
 */
export async function rowsWithItems(db, jobId) {
  const { rows } = await db.query(
    `select ${ROW_COLUMNS} from import_rows
     where job_id = $1 and state = any($2::text[]) and item_id is not null order by id`,
    [jobId, HELD_STATES],
  );
  return rows.map(toRow);
}

/**
 * Every item any job is still holding, for the 2b waiting-list exclusion.
 * A skipped row does not count: it leaves the item to whatever surface is
 * reviewing it.
 * @param {Tx} db
 * @returns {Promise<Set<number>>}
 */
export async function importHeldItemIdSet(db) {
  const { rows } = await db.query(
    'select distinct item_id from import_rows where state = any($1::text[]) and item_id is not null',
    [ITEM_HELD_STATES],
  );
  return new Set(rows.map((row) => row.item_id));
}

/**
 * The newest jobs, each with its counts.
 * @param {Tx} db @param {{ limit: number }} page
 */
export async function jobsRecent(db, { limit }) {
  const { rows } = await db.query(
    'select id, source, status, created_at from import_jobs order by id desc limit $1',
    [limit],
  );
  return Promise.all(rows.map(async (row) => ({
    id: row.id, source: row.source, status: row.status,
    createdAt: new Date(row.created_at).toISOString(), counts: await countsByState(db, row.id),
  })));
}
