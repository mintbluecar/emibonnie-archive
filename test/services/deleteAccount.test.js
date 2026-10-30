// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { IDS } from '../helpers/fixtures.js';
import { ingestDeps, ingest, rows, count } from '../helpers/ingest.js';
import { apiFor } from '../helpers/api.js';
import { signInUser } from '../../src/services/session.js';
import { itemView } from '../../src/services/itemView.js';

const ENV = { AUTH_SECRET: 'test-auth-secret' };

/** @type {any} */
let deps;
before(async () => { deps = await ingestDeps(); });
after(async () => { await deps.db.end(); });

test('delete removes sessions and name; past items show a fan', async () => {
  const { cookie } = await signInUser({ db: deps.db, site: deps.site, now: () => new Date() }, { via: 'x', subject: '55', handle: 'gone_user' });
  const sid = cookie.replace(/^sid=/, '').split(';')[0];

  // They added an item.
  await ingest(deps, IDS.EVENT_B, { actor: 'x:55' });

  const api = apiFor(deps, { env: ENV });
  const res = await api.call('POST', '/api/me/delete', { cookies: { sid }, body: { confirm: 'delete' } });
  assert.equal(res.status, 200, res.text);
  assert.ok(res.setCookies.some((c) => c.startsWith('sid=') && c.includes('Max-Age=0')), 'clears the session cookie');

  // Sessions are gone, the user is soft-deleted with no name.
  assert.equal(await count(deps.db, 'select count(*)::int as n from sessions where user_id = $1', ['x:55']), 0);
  const [user] = await rows(deps.db, "select deleted_at, display_name from users where id = 'x:55'");
  assert.ok(user.deleted_at !== null);
  assert.equal(user.display_name, null);

  // Their past item shows "a fan".
  const view = /** @type {any} */ (await itemView(deps, 'translation', IDS.EVENT_B));
  assert.deepEqual(view.addedBy, { kind: 'fan' });
});

test('without confirm it is 400', async () => {
  const { cookie } = await signInUser({ db: deps.db, site: deps.site, now: () => new Date() }, { via: 'x', subject: '56', handle: 'keep' });
  const sid = cookie.replace(/^sid=/, '').split(';')[0];
  const api = apiFor(deps, { env: ENV });
  const res = await api.call('POST', '/api/me/delete', { cookies: { sid }, body: { confirm: 'no' } });
  assert.equal(res.status, 400);
  const [user] = await rows(deps.db, "select deleted_at from users where id = 'x:56'");
  assert.equal(user.deleted_at, null, 'not deleted without the confirm word');
});

test('a translator who deletes their account keeps credit on their translations', async () => {
  const own = await ingestDeps();
  try {
    // Ingest a translation credited to tl_beta, then sign in as the user who
    // holds that credited account, and delete them.
    await ingest(own, IDS.EVENT_A);
    // Link tl_beta's account (the credited account) to a user, then delete that user.
    const { cookie } = await signInUser({ db: own.db, site: own.site, now: () => new Date() }, { via: 'x', subject: '9002', handle: 'tl_beta' });
    const sid = cookie.replace(/^sid=/, '').split(';')[0];
    const api = apiFor(own, { env: ENV });
    const res = await api.call('POST', '/api/me/delete', { cookies: { sid }, body: { confirm: 'delete' } });
    assert.equal(res.status, 200);

    // The credited account's user_id is cleared, but the item is still credited
    // to tl_beta (the account), not to the deleted user.
    const [account] = await rows(own.db, "select user_id, handle from accounts where platform = 'x' and lower(handle) = 'tl_beta'");
    assert.equal(account.user_id, null);
    const [item] = await rows(own.db, `select i.credited_account_id from items i join item_sources s on s.item_id = i.id and s.role = 'primary' where s.external_id = $1`, [IDS.EVENT_A]);
    assert.ok(item.credited_account_id !== null, 'the translation keeps its credited account');
  } finally {
    await own.db.end();
  }
});
