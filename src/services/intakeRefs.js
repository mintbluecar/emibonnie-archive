// @ts-check
/**
 * Turns the human references the CLI and the seed file use (IG handles,
 * role names, event slugs) into the ids ingest takes, and creates people
 * named on the command line.
 */
import { addPerson, getPersonByHandle } from '../repo/people.js';
import { getEventBySlug } from '../repo/events.js';
import { ITEM_PERSON_ROLES, ROLES } from '../domain/constants.js';
import { BadRequest } from '../domain/errors.js';

/** @typedef {import('../db/common.js').Db} Db */
/** @typedef {import('../domain/speakers.js').SpeakerMap} SpeakerMap */
/** @typedef {{ igHandle: string, displayName: string, emoji: string, colour: string }} PersonSpec */
/** @typedef {Record<string, { person: string } | { role: string }>} SpeakerRefs */

/**
 * Creates each person whose IG handle is unknown; existing people are left
 * alone. Returns how many were created.
 * @param {{ db: Db, site: import('../site/schema.js').Site }} deps
 * @param {PersonSpec[]} specs
 * @param {{ actor: string }} options
 * @returns {Promise<number>}
 */
export async function createPeople({ db, site }, specs, { actor }) {
  let created = 0;
  for (const spec of specs) {
    if (await getPersonByHandle(db, spec.igHandle)) continue;
    await db.transaction((tx) => addPerson(tx, spec, { lowercaseNames: site.lowercaseNames }), { actor });
    created += 1;
  }
  return created;
}

/**
 * `{ marker: { person: '<ig handle>' } | { role } }` → a `SpeakerMap`.
 * Throws `BadRequest` naming an unknown handle or role.
 * @param {Db} db
 * @param {SpeakerRefs} refs
 * @returns {Promise<SpeakerMap>}
 */
export async function resolveSpeakerRefs(db, refs) {
  /** @type {SpeakerMap} */
  const map = {};
  for (const [marker, ref] of Object.entries(refs)) {
    if ('role' in ref) {
      if (!ROLES.includes(/** @type {any} */ (ref.role))) throw new BadRequest(`unknown role for ${marker}: ${ref.role}`);
      map[marker] = { role: /** @type {any} */ (ref.role) };
      continue;
    }
    const person = await getPersonByHandle(db, ref.person);
    if (!person) throw new BadRequest(`unknown person for ${marker}: @${ref.person}`);
    map[marker] = { person: person.id };
  }
  return map;
}

/**
 * @param {Db} db
 * @param {string} slug
 * @returns {Promise<number>}
 */
export async function eventIdBySlug(db, slug) {
  const event = await getEventBySlug(db, slug);
  if (!event) throw new BadRequest(`unknown event: ${slug}`);
  return event.id;
}

/**
 * `overrides.people` (`[{ igHandle, role }]`) → item people. Throws
 * `BadRequest` naming an unknown handle (it must already be a person:
 * created by `createPeople`, a seed's `createPeople`, or featured) or role.
 * @param {Db} db
 * @param {{ igHandle: string, role: string }[]} refs
 * @returns {Promise<import('../kinds/defineKind.js').ItemPerson[]>}
 */
export async function resolvePeopleRefs(db, refs) {
  /** @type {import('../kinds/defineKind.js').ItemPerson[]} */
  const people = [];
  for (const { igHandle, role } of refs) {
    const handle = String(igHandle ?? '').replace(/^@/, '');
    if (!ITEM_PERSON_ROLES.includes(role)) {
      throw new BadRequest(`overrides.people: role for @${handle} must be one of ${ITEM_PERSON_ROLES.join(', ')}`);
    }
    const person = handle ? await getPersonByHandle(db, handle) : null;
    if (!person) throw new BadRequest(`overrides.people: unknown person @${handle} (create them first, e.g. in the seed's createPeople)`);
    people.push({ personId: person.id, role: /** @type {any} */ (role) });
  }
  return people;
}
