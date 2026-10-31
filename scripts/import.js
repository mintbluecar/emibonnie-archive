// @ts-check
/**
 * `npm run import -- --notion export.csv [--links chat.txt] [--pace 1000]
 *   [--retry <jobId>] [--dry-run] [--kind translation] [--report path.csv]`
 *
 * Loads the owner's existing archive (Plan 3): every link is ingested with
 * `holdForReview`, so nothing is public until the review page publishes it.
 * Resumable: rows keep their state, and `--retry` walks the unfinished ones.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadSite } from '../src/site/loadSite.js';
import { createJob, getJob, insertRows, rowsForRun, setJobStatus, updateRow } from '../src/repo/imports.js';
import { parseNotionCsv, extractStatusLinks, resolveArtists, eventOverrideOf } from '../src/services/importSources.js';
import { ensureOwnerUser, runRow } from '../src/services/importJob.js';
import { retryingFetch } from '../src/services/importFetch.js';
import { statusUrl } from '../src/sources/url.js';
import { runCli } from './cli.js';

const OPTIONS = /** @type {const} */ ({
  notion: { type: 'string' },
  links: { type: 'string' },
  pace: { type: 'string' },
  retry: { type: 'string' },
  'dry-run': { type: 'boolean' },
  kind: { type: 'string' },
  report: { type: 'string' },
});

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * The Notion rows, with their artists and event resolved.
 * @param {any} deps @param {string} text @param {(line: string) => void} log
 */
async function notionRows(deps, text, log) {
  const { rows, skipped } = parseNotionCsv(text);
  for (const skip of skipped) log(`skipped CSV row ${skip.row}: ${skip.reason}`);
  /** @type {any[]} */
  const prepared = [];
  for (const row of rows) {
    const artists = await resolveArtists(deps, row.extra.artists);
    const event = await eventOverrideOf(deps, row.extra.keyword);
    prepared.push({
      platform: 'x',
      externalId: row.url.split('/').pop(),
      overrides: {
        ...row.overrides, ...event,
        ...(artists.people.length > 0 ? { people: artists.people } : {}),
        _warnings: [...row.warnings, ...artists.warnings],
      },
    });
  }
  return prepared;
}

/**
 * Creates the job(s) the arguments name. `--dry-run` parses the sources and
 * writes nothing.
 * @param {any} deps @param {{ values: any, read: (path: string) => Promise<string>, log: (line: string) => void }} input
 * @returns {Promise<{ jobs: { jobId: number, source: string }[], dryRun?: number }>}
 */
async function createJobs(deps, { values, read, log }) {
  /** @type {{ jobId: number, source: string }[]} */
  const jobs = [];
  let dryRun = 0;
  if (values.notion) {
    const prepared = await notionRows(deps, await read(values.notion), log);
    if (values['dry-run']) { dryRun += prepared.length; log(`would import ${prepared.length} Notion rows`); }
    else {
      const jobId = await deps.db.transaction((/** @type {any} */ tx) => createJob(tx, { source: 'notion', actor: 'system' }), { actor: 'system' });
      await deps.db.transaction((/** @type {any} */ tx) => insertRows(tx, jobId, prepared), { actor: 'system' });
      jobs.push({ jobId, source: 'notion' });
    }
  }
  if (values.links) {
    const ids = extractStatusLinks(await read(values.links));
    if (values['dry-run']) { dryRun += ids.length; log(`would import ${ids.length} links`); }
    else {
      const jobId = await deps.db.transaction((/** @type {any} */ tx) => createJob(tx, { source: 'paste', actor: 'system' }), { actor: 'system' });
      await deps.db.transaction((/** @type {any} */ tx) => insertRows(tx, jobId, ids.map((id) => ({ platform: 'x', externalId: id, overrides: {} }))), { actor: 'system' });
      jobs.push({ jobId, source: 'paste' });
    }
  }
  return { jobs, ...(dryRun > 0 ? { dryRun } : {}) };
}

/**
 * @param {string} path @param {number} jobId @param {any[]} rows
 * @returns {Promise<string>}
 */
async function reportCsv(path, jobId, rows) {
  const lines = ['url,status,reason', ...rows.map((row) => `${statusUrl(row.externalId)},${row.state},"${String(row.error ?? '').replaceAll('"', '""')}"`)];
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

/** @param {any} deps @param {any} row @param {{ source: string, kind: string, actor: string }} run */
async function processRow(deps, row, { source, kind, actor }) {
  await runRow(deps, { row, kind, actor, source });
}

/**
 * Walks one job's unfinished rows at the requested pace.
 * @param {any} deps
 * @param {{ jobId: number, source: string, kind: string, actor: string, pace: number,
 *   log: (line: string) => void, report?: string }} run
 */
async function runJob(deps, { jobId, source, kind, actor, pace, log, report }) {
  await deps.db.transaction((/** @type {any} */ tx) => setJobStatus(tx, jobId, 'running'), { actor: 'system' });
  const pending = await rowsForRun(deps.db, jobId);
  let done = 0;
  for (const row of pending) {
    if (pace > 0 && done > 0) await sleep(pace);
    try {
      await processRow(deps, row, { source, kind, actor });
    } catch (/** @type {any} */ err) {
      await deps.db.transaction((/** @type {any} */ tx) => updateRow(tx, row.id, { state: 'failed', error: String(err?.message ?? err).slice(0, 500) }), { actor: 'system' });
    }
    done += 1;
    if (done % 25 === 0) log(`${done}/${pending.length} rows`);
  }
  const after = await rowsForRun(deps.db, jobId);
  await deps.db.transaction((/** @type {any} */ tx) => setJobStatus(tx, jobId, after.length === 0 ? 'done' : 'failed'), { actor: 'system' });
  if (report) {
    const { rowsPage } = await import('../src/repo/imports.js');
    const page = await rowsPage(deps.db, jobId, { offset: 0, limit: 10000 });
    log(`report: ${await reportCsv(report, jobId, page.rows)}`);
  }
  return { jobId, processed: done, remaining: after.length };
}

/**
 * The run: create the jobs, walk the unfinished rows at the requested
 * pace, classify each, and report.
 * @param {{ args: string[], deps: any, read?: (path: string) => Promise<string>, log?: (line: string) => void }} input
 */
/**
 * The jobs to run: an explicit retry, or the sources' new jobs.
 * @param {any} deps @param {{ values: any, read: (path: string) => Promise<string>, log: (line: string) => void }} input
 * @returns {Promise<{ jobs: { jobId: number, source: string }[] } | { jobs: [], dryRun: number }>}
 */
async function jobsOf(deps, { values, read, log }) {
  if (values.retry) {
    const job = await getJob(deps.db, Number(values.retry));
    if (!job) throw new Error(`no import job ${values.retry}`);
    return { jobs: [{ jobId: job.id, source: job.source }] };
  }
  const created = await createJobs(deps, { values, read, log });
  return created.dryRun !== undefined ? { jobs: [], dryRun: created.dryRun } : created;
}

/**
 * @param {{ args: string[], deps: any, read?: (path: string) => Promise<string>, log?: (line: string) => void }} input
 */
export async function runImport({ args, deps: rawDeps, read = (/** @type {string} */ path) => readFile(path, 'utf8'), log = console.log }) {
  // 429/5xx from the sources back off (1s, 2s, 4s) before a row is failed.
  const deps = { ...rawDeps, fetchImpl: retryingFetch(rawDeps.fetchImpl) };
  const { values } = parseArgs({ args, options: OPTIONS, allowPositionals: false });
  const kind = values.kind ?? 'translation';
  const pace = values.pace === undefined ? 1000 : Number(values.pace);
  if (!values.notion && !values.links && !values.retry) throw new Error('give --notion <csv>, --links <txt>, or --retry <jobId>');

  const resolved = await jobsOf(deps, { values, read, log });
  if ('dryRun' in resolved) return { jobs: [], dryRun: resolved.dryRun };
  const { jobs } = resolved;

  const actor = await ensureOwnerUser(deps);
  const results = [];
  for (const job of jobs) {
    const result = await runJob(deps, { ...job, kind, actor, pace, log, report: values.report });
    results.push(result);
    log(`job ${job.jobId}: ${result.processed} processed, ${result.remaining} left`);
  }
  return { jobs };
}

function main() {
  return runCli(({ db, siteDir, env }) => {
    const site = loadSite(siteDir);
    const deps = { db, site, fetchImpl: globalThis.fetch, env };
    return runImport({ args: process.argv.slice(2), deps });
  }, { db: 'required' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
