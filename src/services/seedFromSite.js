// @ts-check
/**
 * Seeds the database from a loaded site, filling in only what's missing:
 * existing people, categories and ignored hashtags are left alone (admin
 * edits win). The actor for every write here is `'system'`.
 */
import { addPerson, getPersonByHandle } from '../repo/people.js';
import { upsertAccount } from '../repo/accounts.js';
import { ensureCategory } from '../repo/lookups.js';
import { setIgnoredIfMissing } from '../repo/tags.js';
import { get as getSetting, set as setSetting } from '../repo/settings.js';

/** @typedef {import('../db/common.js').Db} Db */
/** @typedef {import('../site/schema.js').Site} Site */
/** @typedef {import('../site/schema.js').FeaturedPerson} FeaturedPerson */

const SYSTEM = { actor: 'system' };

/**
 * Stores `settings.timezone` on first run. On later runs, refuses to
 * continue if `site.timezone` differs: changing it would reinterpret
 * every stored date.
 * @param {Db} db
 * @param {Site} site
 * @returns {Promise<void>}
 */
async function ensureTimezone(db, site) {
  const stored = await getSetting(db, 'timezone');
  if (stored === undefined) {
    await db.transaction((tx) => setSetting(tx, 'timezone', site.timezone), SYSTEM);
    return;
  }
  if (stored !== site.timezone) {
    throw new Error(
      `timezone changed: settings.timezone is "${stored}" but site.timezone is "${site.timezone}" -- ` +
        'changing it would reinterpret every stored date',
    );
  }
}

/**
 * Creates each of a featured person's `otherAccounts` as a handle-only
 * account linked to them, with `is_identity` false. Leaves an
 * already-linked account's `person_id` alone.
 * @param {Db} db
 * @param {number} personId
 * @param {FeaturedPerson['otherAccounts']} otherAccounts
 * @returns {Promise<void>}
 */
async function ensureOtherAccounts(db, personId, otherAccounts) {
  for (const other of otherAccounts) {
    await db.transaction(async (tx) => {
      const accountId = await upsertAccount(tx, { platform: other.platform, handle: other.handle });
      await tx.query('update accounts set person_id = $1 where id = $2 and person_id is null', [personId, accountId]);
    }, SYSTEM);
  }
}

/**
 * Creates a featured person if their IG handle is unknown; an existing
 * person is left alone.
 * @param {Db} db
 * @param {FeaturedPerson} person
 * @param {boolean} lowercaseNames
 * @returns {Promise<void>}
 */
async function ensurePerson(db, person, lowercaseNames) {
  const existing = await getPersonByHandle(db, person.igHandle);
  const personId = existing
    ? existing.id
    : await db.transaction(
        (tx) =>
          addPerson(
            tx,
            { igHandle: person.igHandle, displayName: person.displayName, emoji: person.emoji, colour: person.colour, featured: true },
            { lowercaseNames },
          ).then((created) => created.id),
        SYSTEM,
      );
  await ensureOtherAccounts(db, personId, person.otherAccounts ?? []);
}

/**
 * @param {{ db: Db, site: Site }} deps
 * @returns {Promise<{ people: number, hashtags: number, categories: number }>}
 */
export async function seedFromSite({ db, site }) {
  await ensureTimezone(db, site);

  for (const person of site.featuredPeople) {
    await ensurePerson(db, person, site.lowercaseNames);
  }

  await db.transaction((tx) => setIgnoredIfMissing(tx, site.ignoredHashtags), SYSTEM);
  await db.transaction(async (tx) => {
    for (const name of site.categories) await ensureCategory(tx, name);
  }, SYSTEM);

  return { people: site.featuredPeople.length, hashtags: site.ignoredHashtags.length, categories: site.categories.length };
}
