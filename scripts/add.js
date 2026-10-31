// @ts-check
/**
 * `npm run add -- <url|id> [--map <marker>=@<ig>|<role>]… [--shared-story]
 *   [--event <slug>] [--new-event] [--date YYYY-MM-DD]
 *   [--create-person <ig>:<name>:<emoji>:#<colour>]… [--kind <kind>]`
 *
 * Archives one post with actor `'system'` and prints the result. Exits 2
 * when speakers (or a date) are still needed, listing what's missing.
 */
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadSite } from '../src/site/loadSite.js';
import { ingestItem } from '../src/services/ingest.js';
import { createPeople, eventIdBySlug, resolveSpeakerRefs } from '../src/services/intakeRefs.js';
import { loadCopy } from '../src/site/copy.js';
import { BARE_MARKER } from '../src/domain/lines.js';
import { runCli } from './cli.js';

const SYSTEM = { actor: 'system' };
const OPTIONS = /** @type {const} */ ({
  map: { type: 'string', multiple: true },
  'shared-story': { type: 'boolean' },
  event: { type: 'string' },
  'new-event': { type: 'boolean' },
  date: { type: 'string' },
  'create-person': { type: 'string', multiple: true },
  kind: { type: 'string' },
});

/** @param {string} arg `<ig>:<name>:<emoji>:#<colour>` */
function personSpec(arg) {
  const parts = arg.split(':');
  if (parts.length < 4) throw new Error(`--create-person wants ig:name:emoji:#colour, got ${arg}`);
  return { igHandle: parts[0], displayName: parts[1], emoji: parts.slice(2, -1).join(':'), colour: parts[parts.length - 1] };
}

/** @param {string[]} args `<marker>=@<ig>` or `<marker>=<role>` */
function speakerRefs(args) {
  return Object.fromEntries(args.map((arg) => {
    const at = arg.indexOf('=');
    if (at < 1) throw new Error(`--map wants <marker>=@<ig> or <marker>=<role>, got ${arg}`);
    const value = arg.slice(at + 1);
    return [arg.slice(0, at), value.startsWith('@') ? { person: value.slice(1) } : { role: value }];
  }));
}

/**
 * @param {import('../src/db/common.js').Db} db
 * @param {any} values
 */
async function overridesOf(db, values) {
  return {
    ...(values['shared-story'] ? { placement: /** @type {const} */ ('shared_story') } : {}),
    ...(values.event ? { eventId: await eventIdBySlug(db, values.event) } : {}),
    ...(values['new-event'] ? { newEvent: true } : {}),
    ...(values.date ? { occurredOn: values.date } : {}),
  };
}

/**
 * Prints the result. A missing bare ':' marker (a speaker with no emoji)
 * shows as the `speaker.noEmoji` copy, "(no emoji)"; map it with
 * `--map :=<role>` or `--map :=@<ig>`.
 * @param {import('../src/services/ingest.js').IngestResult} result
 * @param {(line: string) => void} log
 * @param {Record<string, string>} [copy]
 * @returns {number} the exit code
 */
export function report(result, log, copy = loadCopy()) {
  const shown = (/** @type {string} */ marker) => (marker === BARE_MARKER ? copy['speaker.noEmoji'] : marker);
  log([result.status, result.sourceId, result.itemId ? `item ${result.itemId}` : ''].filter(Boolean).join(' '));
  for (const m of /** @type {{marker: string, count: number}[]} */ (result.missing ?? [])) log(`  missing ${shown(m.marker)} (${m.count} lines)`);
  for (const t of /** @type {string[]} */ (result.newTags ?? [])) log(`  new tag #${t}`);
  if (result.status === 'needs_date') log('  no date found: pass --date YYYY-MM-DD');
  return result.status === 'needs_speakers' || result.status === 'needs_date' ? 2 : 0;
}

/**
 * Runs the command against given deps (tests pass an offline `fetchImpl`).
 * @param {{ args: string[], deps: import('../src/services/ingest.js').IngestDeps, log?: (line: string) => void }} options
 * @returns {Promise<number>} the exit code
 */
export async function runAdd({ args, deps, log = console.log }) {
  const { values, positionals } = parseArgs({ args, options: OPTIONS, allowPositionals: true });
  if (positionals.length !== 1) throw new Error('usage: npm run add -- <url|id> [options]');
  await createPeople(deps, (values['create-person'] ?? []).map(personSpec), SYSTEM);
  const chosen = await resolveSpeakerRefs(deps.db, speakerRefs(values.map ?? []));
  const overrides = await overridesOf(deps.db, values);
  const result = await ingestItem(deps, { kind: values.kind ?? 'translation', input: positionals[0], chosen, overrides, addedVia: 'cli', ...SYSTEM });
  return report(result, log);
}

function main() {
  return runCli(async ({ db, siteDir, log }) => {
    const site = loadSite(siteDir);
    const deps = { db: /** @type {import('../src/db/common.js').Db} */ (db), site, fetchImpl: fetch };
    process.exitCode = await runAdd({ args: process.argv.slice(2), deps, log });
  }, { db: 'required' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
