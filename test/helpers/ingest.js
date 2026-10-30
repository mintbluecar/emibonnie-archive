// @ts-check
/**
 * Ingest test deps: a fresh, set-up database for the example site, the
 * synthetic fixtures served offline, and a fixed clock.
 */
import { freshDb } from './db.js';
import { FIXTURES_DIR } from './fixtures.js';
import { offlineFetch } from '../../src/sources/offlineFetch.js';
import { loadSite } from '../../src/site/loadSite.js';
import { runSetup } from '../../scripts/setup.js';
import { ingestItem } from '../../src/services/ingest.js';
import { createPeople, resolveSpeakerRefs } from '../../src/services/intakeRefs.js';
import { runSeedDev } from '../../scripts/seedDev.js';

export const SITE_DIR = 'examples/solluna';
export const site = loadSite(SITE_DIR);
export const NOW = new Date('2026-10-21T00:00:00.000Z');
export const SYSTEM = { actor: 'system' };
export const HOST = { igHandle: 'host_x', displayName: 'host', emoji: '🦁', colour: '#b5651d' };
/** LONG's speakers, by IG handle / role. */
export const LONG_REFS = { '🦁': { person: 'host_x' }, '🌧️': { role: 'fan' }, '🐶': { person: 'solsunny' }, '🐱': { person: 'lunamoon' } };

/**
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export async function ingestDeps({ fetchImpl } = {}) {
  const db = await freshDb();
  await runSetup({ db, site, siteDir: SITE_DIR, log: () => {} });
  return { db, site, fetchImpl: fetchImpl ?? offlineFetch(FIXTURES_DIR), now: () => NOW };
}

/**
 * @param {any} deps
 * @param {string} id
 * @param {Partial<import('../../src/services/ingest.js').IngestRequest>} [extra]
 */
export function ingest(deps, id, extra = {}) {
  return ingestItem(deps, { kind: 'translation', input: id, addedVia: 'cli', actor: 'system', ...extra });
}

/** Creates the host person and ingests LONG with every speaker mapped. @param {any} deps */
export async function ingestLong(deps) {
  await createPeople(deps, [HOST], SYSTEM);
  const chosen = await resolveSpeakerRefs(deps.db, LONG_REFS);
  return ingest(deps, '1900000000000000001', { chosen });
}

/**
 * @param {any} db
 * @param {string} sql
 * @param {unknown[]} [params]
 */
export async function rows(db, sql, params = []) {
  return (await db.query(sql, params)).rows;
}

/**
 * @param {any} db
 * @param {string} sql a `select count(*)::int as n …`
 * @param {unknown[]} [params]
 */
export async function count(db, sql, params = []) {
  return (await rows(db, sql, params))[0].n;
}

/**
 * An item's sources (with the credited handle), by role then position.
 * @param {any} db @param {number} itemId
 */
export async function sourcesOf(db, itemId) {
  return rows(db, `select s.role, s.position, s.external_id, s.media, s.editable_until, a.handle
    from item_sources s left join accounts a on a.id = s.account_id where s.item_id = $1 order by s.role, s.position`, [itemId]);
}

/**
 * A `fetchImpl` serving the fixtures, with `patch(kind, id, json)` able
 * to rewrite any response body, and a count of requests per id.
 * @param {(kind: 'syn'|'fx'|'thread', id: string, json: any) => any} patch
 */
export function patchedFetch(patch) {
  const real = offlineFetch(FIXTURES_DIR);
  /** @type {Record<string, number>} */
  const calls = {};
  const fetchImpl = async (/** @type {any} */ input, /** @type {any} */ init) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const isSyn = url.hostname === 'cdn.syndication.twimg.com';
    const id = isSyn ? url.searchParams.get('id') ?? '' : url.pathname.split('/')[3] ?? '';
    const kind = isSyn ? 'syn' : url.pathname.split('/')[2] === 'thread' ? 'thread' : 'fx';
    calls[id] = (calls[id] ?? 0) + 1;
    const res = await real(input, init);
    if (!res.ok) return res;
    const json = patch(/** @type {any} */ (kind), id, await res.json());
    return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl: /** @type {typeof fetch} */ (fetchImpl), calls };
}

/**
 * `ingestDeps()` with every post of the example site's seed (`seed/maps.json`:
 * the live fixtures, every speaker mapped) ingested.
 */
export async function seededDeps() {
  const deps = await ingestDeps();
  await runSeedDev({ siteDir: SITE_DIR, db: deps.db, log: () => {} });
  return deps;
}

/**
 * The item archiving `sourceId` as its primary source.
 * @param {any} db
 * @param {string} sourceId
 * @returns {Promise<number>}
 */
export async function itemIdOf(db, sourceId) {
  const [row] = await rows(db, "select item_id from item_sources where role = 'primary' and external_id = $1", [sourceId]);
  return row.item_id;
}
