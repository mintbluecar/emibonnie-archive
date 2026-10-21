// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import { loadSite } from '../../src/site/loadSite.js';
import { seedFromSite } from '../../src/services/seedFromSite.js';
import { listPeople, listPersonAccounts } from '../../src/repo/people.js';
import { ignoredHashtags } from '../../src/repo/tags.js';
import { listCategories } from '../../src/repo/lookups.js';
import { get as getSetting } from '../../src/repo/settings.js';

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
const site = loadSite('examples/solluna');
const system = { actor: 'system' };

before(async () => { db = await freshDb(); });
after(async () => { await db.end(); });

test('seedFromSite seeds the example site: people, otherAccounts, timezone, ignored hashtags, categories', async () => {
  const result = await seedFromSite({ db, site });
  assert.deepEqual(result, {
    people: site.featuredPeople.length,
    hashtags: site.ignoredHashtags.length,
    categories: site.categories.length,
  });

  const people = await listPeople(db);
  assert.equal(people.length, site.featuredPeople.length);
  for (const fp of site.featuredPeople) {
    const found = people.find((p) => p.igHandle === fp.igHandle);
    assert.ok(found, `expected a person for ${fp.igHandle}`);
  }

  const withOtherAccount = site.featuredPeople.find((fp) => (fp.otherAccounts ?? []).length > 0);
  assert.ok(withOtherAccount, 'the fixture site needs at least one otherAccounts entry to exercise this');
  const personAccounts = await listPersonAccounts(db);
  const other = withOtherAccount.otherAccounts[0];
  const linked = personAccounts.find((a) => a.platform === other.platform && a.handle === other.handle);
  assert.ok(linked, 'expected the otherAccounts entry linked to its person');

  assert.equal(await getSetting(db, 'timezone'), site.timezone);
  const ignored = await ignoredHashtags(db);
  for (const tag of site.ignoredHashtags) assert.ok(ignored.includes(tag));
  const categories = (await listCategories(db)).map((c) => c.name);
  for (const name of site.categories) assert.ok(categories.includes(name));
});

test("running seedFromSite again doesn't overwrite a colour the owner changed", async () => {
  const people = await listPeople(db);
  const first = people[0];
  await db.transaction((tx) => tx.query('update people set colour = $1 where id = $2', ['#ffffff', first.id]), system);

  await seedFromSite({ db, site });

  const after2 = await listPeople(db);
  const same = after2.find((p) => p.id === first.id);
  assert.equal(same?.colour, '#ffffff');
});

test('a changed site.timezone throws "timezone changed"', async () => {
  await assert.rejects(seedFromSite({ db, site: { ...site, timezone: 'UTC' } }), /timezone changed/);
});
