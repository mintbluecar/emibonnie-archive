// @ts-check
/**
 * The signed-in add flow: options for the form, a preview (dry-run ingest)
 * and the final add. The preview never writes; the add reuses the single
 * ingest path. Credit and speaker mapping stay exactly ingest's.
 */
import { ingestItem } from './ingest.js';
import { ROLES } from '../domain/constants.js';
import { listPeople, addPerson, getPersonByHandle } from '../repo/people.js';
import { listVisibleEvents } from '../repo/events.js';
import { listCategories, listClients } from '../repo/lookups.js';

/** @typedef {import('../db/common.js').Db} Db */
/** @typedef {import('../services/session.js').SessionUser} SessionUser */
/** @typedef {import('./ingest.js').IngestResult} IngestResult */

/**
 * The form's options: known people, generic roles, recent events, and the
 * owner-managed category (type) and client lists.
 * @param {{ db: Db }} deps
 * @returns {Promise<{ people: {id:number, displayName:string, emoji:string, igHandle:string|null}[],
 *   roles: string[], events: {id:number, name:string, slug:string, occurredOn:string}[],
 *   categories: string[], clients: string[] }>}
 */
export async function addOptions(deps) {
  const [people, events, categories, clients] = await Promise.all([
    listPeople(deps.db), listVisibleEvents(deps.db, { limit: 200 }),
    listCategories(deps.db), listClients(deps.db),
  ]);
  return {
    people: people.map((p) => ({ id: p.id, displayName: p.displayName, emoji: p.emoji, igHandle: p.igHandle })),
    roles: [...ROLES],
    events: events.map((e) => ({ id: e.id, name: e.name, slug: e.slug, occurredOn: e.occurredOn })),
    categories: categories.map((c) => c.name),
    clients: clients.map((c) => c.name),
  };
}

/**
 * The ingest request a preview or add builds from the form body.
 * @param {SessionUser} user
 * @param {unknown} body
 * @param {{ dryRun: boolean }} opts
 */
function requestOf(user, body, { dryRun }) {
  const b = /** @type {any} */ (body);
  return {
    kind: 'translation',
    input: String(b.url ?? '').trim(),
    chosen: b.chosen,
    overrides: b.overrides,
    lineFixes: b.lineFixes,
    subbed: b.subbed,
    lookups: /** @type {'create'|'existing'} */ (user.isOwner ? 'create' : 'existing'),
    addedVia: 'submit',
    actor: user.id,
    dryRun,
    allowUnmapped: true,
  };
}

/** @param {SessionUser} user */
function addingAs(user) {
  return user.handle ?? user.displayName;
}

/**
 * @param {import('./ingest.js').IngestDeps} deps
 * @param {SessionUser} user
 * @param {unknown} body
 * @returns {Promise<IngestResult & { addingAs: string|null, url?: string }>} the ingest result plus `addingAs`
 */
export async function previewAdd(deps, user, body) {
  const result = await ingestItem(deps, requestOf(user, body, { dryRun: true }));
  const linkable = result.status === 'duplicate' || result.status === 'attached';
  return { ...result, addingAs: addingAs(user), ...(linkable ? { url: itemPath(result.sourceId) } : {}) };
}

/**
 * The archived entry's public path, for the add flow's "here it is" links
 * (the add flow is the translation kind's; ingest's results carry no kind).
 * @param {string} sourceId
 * @returns {string}
 */
function itemPath(sourceId) {
  return `/t/${sourceId}`;
}

/**
 * @param {import('./ingest.js').IngestDeps} deps
 * @param {SessionUser} user
 * @param {unknown} body
 * @returns {Promise<IngestResult & { addingAs: string|null, url?: string }>} the ingest result plus `url` on a saved outcome
 */
export async function addItem(deps, user, body) {
  const result = await ingestItem(deps, requestOf(user, body, { dryRun: false }));
  const saved = result.status === 'added' || result.status === 'attached' || result.status === 'duplicate';
  return { ...result, addingAs: addingAs(user), ...(saved ? { url: itemPath(result.sourceId) } : {}) };
}

/**
 * `POST /api/people`: creates a person from a display name and IG handle
 * (or returns the person already holding that handle).
 * @param {{ db: Db, site: import('../site/schema.js').Site }} deps
 * @param {{ displayName: string, igHandle: string, actor: string }} input
 * @returns {Promise<{ id: number }>}
 */
export async function addNewPerson(deps, { displayName, igHandle, actor }) {
  const handle = igHandle.replace(/^@/, '');
  const existing = await getPersonByHandle(deps.db, handle);
  if (existing) return { id: existing.id };
  const person = await deps.db.transaction(
    (tx) => addPerson(tx, { igHandle: handle, displayName, emoji: '🙂', colour: '#888888' }, { lowercaseNames: deps.site.lowercaseNames }),
    { actor },
  );
  return { id: person.id };
}
