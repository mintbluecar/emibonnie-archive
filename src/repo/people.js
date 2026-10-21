// @ts-check
/**
 * people: the owner's known people. `igHandle` comes from a person's
 * Instagram identity account (`accounts.is_identity`); `extraHashtags`
 * from their aliases (`person_aliases`).
 *
 * `addPerson` is used only to create a *featured* person today (there is
 * no other kind of person yet in Plan 1a), so it always sets
 * `people.featured = true`.
 */
import { cleanDisplayName, norm } from '../domain/text.js';
import { camelRow } from './rows.js';
import { getAccountByHandle } from './accounts.js';

/** @typedef {{ query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }} Tx */
/**
 * @typedef {{ id: number, displayName: string, emoji: string, colour: string,
 *   featured: boolean, igHandle: string|null, extraHashtags: string[] }} Person
 */

/**
 * @param {Tx} db
 * @param {string|null} handle lower-cased, no leading `@`; `null` selects everyone.
 * @returns {Promise<Person[]>}
 */
async function selectPeople(db, handle = null) {
  const { rows } = await db.query(
    `select p.id, p.display_name, p.emoji, p.colour, p.featured, a.handle as ig_handle,
       coalesce(array_agg(pa.alias) filter (where pa.alias is not null), '{}') as extra_hashtags
     from people p
     left join accounts a on a.person_id = p.id and a.is_identity and a.platform = 'instagram' and a.deleted_at is null
     left join person_aliases pa on pa.person_id = p.id
     where p.deleted_at is null ${handle !== null ? 'and lower(a.handle) = $1' : ''}
     group by p.id, a.handle
     order by p.id`,
    handle !== null ? [handle] : [],
  );
  return /** @type {Person[]} */ (rows.map(camelRow));
}

/** @param {Tx} db @returns {Promise<Person[]>} */
export async function listPeople(db) {
  return selectPeople(db);
}

/** @param {Tx} db @param {string} igHandle @returns {Promise<Person|null>} */
export async function getPersonByHandle(db, igHandle) {
  const handle = norm(igHandle.replace(/^@/, ''));
  const [person] = await selectPeople(db, handle);
  return person ?? null;
}

/**
 * Creates a person plus an Instagram identity account. Throws `duplicate
 * person` when the handle already identifies someone.
 * @param {Tx} tx
 * @param {{ igHandle: string, displayName: string, emoji: string, colour: string }} input
 * @param {{ lowercaseNames?: boolean }} [options]
 * @returns {Promise<Person>}
 */
export async function addPerson(tx, { igHandle, displayName, emoji, colour }, { lowercaseNames = false } = {}) {
  const handle = norm(igHandle.replace(/^@/, ''));
  const already = await getAccountByHandle(tx, 'instagram', handle);
  if (already?.personId) throw new Error(`duplicate person: @${handle} already identifies someone`);

  const cleaned = cleanDisplayName(displayName);
  const name = lowercaseNames ? cleaned.toLowerCase() : cleaned;
  const { rows } = await tx.query(
    'insert into people (display_name, emoji, colour, featured) values ($1, $2, $3, true) returning id',
    [name, emoji, colour],
  );
  const personId = rows[0].id;
  await tx.query(
    "insert into accounts (platform, handle, person_id, is_identity) values ('instagram', $1, $2, true)",
    [handle, personId],
  );
  const [person] = await selectPeople(tx, handle);
  return person;
}

/**
 * Every account linked to a known person (identity or other), for
 * post-author detection.
 * @param {Tx} db
 * @returns {Promise<{ platform: string, handle: string, personId: number }[]>}
 */
export async function listPersonAccounts(db) {
  const { rows } = await db.query(
    'select platform, handle, person_id from accounts where person_id is not null and deleted_at is null order by person_id, platform',
  );
  return /** @type {{ platform: string, handle: string, personId: number }[]} */ (rows.map(camelRow));
}
