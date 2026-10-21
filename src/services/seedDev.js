// @ts-check
/**
 * Loads a site's synthetic sample data (`<site>/seed/maps.json`) for local
 * development: creates the listed people, then ingests each listed post in
 * the file's key order with actor `'system'`, as `maps.kind` (default: the
 * engine's built-in translation kind).
 */
import { ingestItem } from './ingest.js';
import { createPeople, resolveSpeakerRefs } from './intakeRefs.js';

/** @typedef {import('./ingest.js').IngestDeps} IngestDeps */
/** @typedef {import('./ingest.js').IngestResult} IngestResult */
/**
 * @typedef {{ kind?: string, createPeople?: import('./intakeRefs.js').PersonSpec[],
 *   tweets?: Record<string, { chosen?: import('./intakeRefs.js').SpeakerRefs,
 *     overrides?: import('../kinds/defineKind.js').DraftOverrides }> }} SeedMaps
 */

const SYSTEM = { actor: 'system' };

/**
 * @param {IngestDeps} deps
 * @param {SeedMaps} maps
 * @returns {Promise<IngestResult[]>}
 */
export async function seedDev(deps, maps) {
  const kind = maps.kind ?? 'translation';
  await createPeople(deps, maps.createPeople ?? [], SYSTEM);
  /** @type {IngestResult[]} */
  const results = [];
  for (const [id, entry] of Object.entries(maps.tweets ?? {})) {
    const chosen = await resolveSpeakerRefs(deps.db, entry.chosen ?? {});
    results.push(await ingestItem(deps, { kind, input: id, chosen, overrides: entry.overrides ?? {}, addedVia: 'cli', ...SYSTEM }));
  }
  return results;
}
