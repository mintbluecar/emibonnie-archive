// @ts-check
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { freshDb } from '../helpers/db.js';
import {
  signInUser, currentUser, requireUser, setDisplayName, signOut, signOutEverywhere,
} from '../../src/services/session.js';
import { Unauthorized, Forbidden } from '../../src/http/errors.js';

const SITE = { ownerXUserId: '42' };

/** @type {Awaited<ReturnType<typeof freshDb>>} */
let db;
/** @type {number} */
let clock;
before(async () => {
  db = await freshDb();
  clock = new Date('2026-01-01T00:00:00.000Z').getTime();
});
after(async () => { await db.end(); });

/** @param {number} ms */
const advance = (ms) => { clock += ms; };
const deps = () => ({ db, site: SITE, now: () => new Date(clock) });
const input = (cookies = {}) => ({ cookies, params: {}, query: {}, body: undefined, origin: 'https://a', ip: null });

test('x sign-in creates the user, links their credited account, and recognises them as translator', async () => {
  // An account already credited on an item (external_id known) becomes the user's.
  const accountId = await db.transaction(async (tx) => {
    const { rows: created } = await tx.query("insert into accounts (platform, handle, external_id) values ('x', 'acct_1', '999') returning id");
    await tx.query(
      "insert into items (kind, placement, occurred_on, added_via, review_state, sort_key, credited_account_id) values ('translation', 'unsorted', '2026-10-01', 'cli', 'published', 1, $1)",
      [created[0].id],
    );
    return created[0].id;
  }, { actor: 'system' });
  const { user, cookie } = await signInUser(deps(), { via: 'x', subject: '999', handle: 'acct_1' });
  assert.equal(user.id, 'x:999');
  assert.equal(user.xUserId, '999');
  assert.equal(user.handle, 'acct_1');
  assert.ok(cookie.startsWith('sid='));
  assert.deepEqual(user.translatorAccountIds, [accountId]);

  const current = await currentUser(deps(), input({ sid: cookie.replace(/^sid=/, '').split(';')[0] }));
  assert.ok(current);
  assert.equal(current.id, 'x:999');
});

test('a google user keeps the display name they chose across a later sign-in', async () => {
  await signInUser(deps(), { via: 'google', subject: 'g-keep', handle: null });
  await setDisplayName(deps(), 'google:g-keep', 'Nice Fan');
  const again = await signInUser(deps(), { via: 'google', subject: 'g-keep', handle: null });
  assert.equal(again.user.displayName, 'Nice Fan');
});

test('only the owner X id gets role owner', async () => {
  const { user: owner } = await signInUser(deps(), { via: 'x', subject: '42', handle: 'the_owner' });
  assert.equal(owner.isOwner, true);
  const { user: member } = await signInUser(deps(), { via: 'x', subject: '7', handle: 'someone' });
  assert.equal(member.isOwner, false);
  const { user: g } = await signInUser(deps(), { via: 'google', subject: 'g-sub', handle: null });
  assert.equal(g.isOwner, false);
});

test('a session expires after 7 days', async () => {
  const { cookie } = await signInUser(deps(), { via: 'x', subject: '100', handle: 'h' });
  const token = cookie.replace(/^sid=/, '').split(';')[0];
  assert.ok(await currentUser(deps(), input({ sid: token })));
  advance(7 * 24 * 60 * 60 * 1000); // exactly 7 days -> expired
  assert.equal(await currentUser(deps(), input({ sid: token })), null);
});

test('the token is stored hashed', async () => {
  await signInUser(deps(), { via: 'x', subject: '200', handle: 'h2' });
  const { rows } = await db.query("select token_hash from sessions where user_id = 'x:200'");
  assert.equal(rows.length, 1);
  const stored = rows[0].token_hash;
  assert.match(stored, /^[0-9a-f]{64}$/, 'sha256 hex, not the raw token');
  assert.ok(!stored.includes('sid='));
});

test('a blocked user is refused by requireUser but still read by currentUser', async () => {
  const { cookie } = await signInUser(deps(), { via: 'x', subject: '300', handle: 'h3' });
  const token = cookie.replace(/^sid=/, '').split(';')[0];
  await db.transaction((tx) => tx.query("update users set blocked_at = now() where id = 'x:300'"), { actor: 'system' });
  const ctx = input({ sid: token });
  const current = await currentUser(deps(), ctx);
  assert.ok(current);
  assert.equal(current.isBlocked, true);
  await assert.rejects(requireUser(deps(), ctx), Forbidden);
  // allowBlocked lets it through.
  assert.ok(await requireUser(deps(), ctx, { allowBlocked: true }));
});

test('requireUser throws Unauthorized when signed out', async () => {
  await assert.rejects(requireUser(deps(), input({})), Unauthorized);
});

test('sign out ends the session and clears the cookie', async () => {
  const { cookie } = await signInUser(deps(), { via: 'x', subject: '500', handle: 'h5' });
  const token = cookie.replace(/^sid=/, '').split(';')[0];
  const clear = await signOut(deps(), input({ sid: token }));
  assert.ok(clear.some((c) => c.startsWith('sid=') && /Max-Age=0/.test(c)), 'clears the session cookie');
  assert.equal(await currentUser(deps(), input({ sid: token })), null);
});

test('sign-in sets the readable signed_in hint for the session\'s lifetime; sign-out clears it', async () => {
  const { cookie, cookies } = await signInUser(deps(), { via: 'x', subject: '510', handle: 'h51' });
  assert.equal(cookies[0], cookie, 'the session cookie comes first');
  const hint = cookies.find((c) => c.startsWith('signed_in='));
  assert.equal(hint, 'signed_in=1; Max-Age=604800; Secure; SameSite=Lax; Path=/');
  assert.ok(!/HttpOnly/i.test(hint ?? ''), 'the page can read the hint');
  assert.match(cookie, /Max-Age=604800; HttpOnly/, 'the session cookie stays HttpOnly, with the same lifetime');
  const token = cookie.replace(/^sid=/, '').split(';')[0];
  const clear = await signOut(deps(), input({ sid: token }));
  assert.ok(clear.includes('signed_in=; Max-Age=0; Secure; SameSite=Lax; Path=/'), 'sign-out clears the hint');
});

test('sign out everywhere ends every session of that user only', async () => {
  const a = await signInUser(deps(), { via: 'x', subject: '600', handle: 'a' });
  const a2 = await signInUser(deps(), { via: 'x', subject: '600', handle: 'a' });
  const b = await signInUser(deps(), { via: 'x', subject: '601', handle: 'b' });
  await signOutEverywhere(deps(), 'x:600');
  const ta = a.cookie.replace(/^sid=/, '').split(';')[0];
  const ta2 = a2.cookie.replace(/^sid=/, '').split(';')[0];
  const tb = b.cookie.replace(/^sid=/, '').split(';')[0];
  assert.equal(await currentUser(deps(), input({ sid: ta })), null);
  assert.equal(await currentUser(deps(), input({ sid: ta2 })), null);
  assert.ok(await currentUser(deps(), input({ sid: tb })), "b's session survives");
});
