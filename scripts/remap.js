// @ts-check
/**
 * `npm run remap -- <sourceId> '<marker>=person:<igHandle>'|'<marker>=role:<fan|host|speaker|crowd>'… [--kind <kind>]`
 *
 * The owner's fix for a marker on an archived item (Task 10c): sets who
 * each marker means and updates the item's people to match, in one
 * transaction with actor `'system'`, so the audit log records it. The
 * text is never changed. Refuses a marker the text doesn't use, an
 * unknown person or role, and a hidden or removed item (a pending one is
 * fine). A marker typed with or without the emoji variation selector
 * (U+FE0F) that the text spells the other way is matched, with a
 * "using …" note; one that could match several is refused. Like
 * `npm run migrate`, it refuses to run with neither `DATABASE_URL` nor
 * `PGLITE_DIR` set. Never prints the connection string.
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createDb, dbOptionsFromEnv } from '../src/db/client.js';
import { loadSite } from '../src/site/loadSite.js';
import { remapItem } from '../src/services/remap.js';
import { errorText } from './migrate.js';

const USAGE = "usage: npm run remap -- <sourceId> '<marker>=person:<igHandle>'|'<marker>=role:<role>'… [--kind <kind>]";

/**
 * `<marker>=person:<ig>` / `<marker>=role:<role>` → speaker refs. The
 * marker is everything before the last `=` that's followed by `person:`
 * or `role:`, so a bare ':' marker (`:=role:fan`) works too.
 * @param {string[]} args
 * @returns {import('../src/services/intakeRefs.js').SpeakerRefs}
 */
export function remapRefs(args) {
  return Object.fromEntries(args.map((arg) => {
    const match = /^(.+)=(person|role):@?(.+)$/u.exec(arg);
    if (!match) throw new Error(`want <marker>=person:<igHandle> or <marker>=role:<role>, got ${arg}`);
    const [, marker, type, value] = match;
    return [marker, type === 'person' ? { person: value } : { role: value }];
  }));
}

/**
 * Where it writes: `DATABASE_URL` or a local `PGLITE_DIR`; with neither it
 * refuses, rather than remapping a throwaway in-memory database.
 * @param {Record<string, string|undefined>} env
 */
export function remapTargetOf(env) {
  if (!env.DATABASE_URL && !env.PGLITE_DIR) throw new Error('DATABASE_URL is not set (set PGLITE_DIR to remap on a local dev database)');
  return dbOptionsFromEnv(env);
}

/**
 * @param {{ args: string[], deps: { db: any, site: any }, log?: (line: string) => void }} options
 * @returns {Promise<void>}
 */
export async function runRemap({ args, deps, log = console.log }) {
  const { values, positionals } = parseArgs({ args, options: { kind: { type: 'string' } }, allowPositionals: true });
  const [sourceId, ...pairs] = positionals;
  if (!sourceId || pairs.length === 0) throw new Error(USAGE);
  const result = await remapItem(deps, { kind: values.kind, sourceId, refs: remapRefs(pairs), actor: 'system' });
  for (const note of result.notes ?? []) log(note);
  log(`remapped item ${result.itemId} (${sourceId}): ${pairs.join(' ')}`);
  log(`  people: ${result.people.map((p) => `${p.personId}/${p.role}`).join(', ') || 'none'}`);
}

async function main() {
  const db = createDb(remapTargetOf(process.env));
  try {
    await runRemap({ args: process.argv.slice(2), deps: { db, site: loadSite(process.env.SITE_DIR ?? 'site') } });
  } finally {
    await db.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((/** @type {any} */ err) => {
    console.error(errorText(err));
    process.exitCode = 1;
  });
}
