// @ts-check
/**
 * The signed-in user's own interface: `GET /api/me` (who am I?), `GET
 * /api/me/added` (the items they submitted, every review state), `POST
 * /api/me/name` (a Google user picks their public name), `POST
 * /api/auth/signout` and `/api/auth/signout-all`.
 */
import { NO_STORE } from '../http/handler.js';
import { BadRequest } from '../http/errors.js';
import { jsonWithCookies } from '../http/cookies.js';
import { defineRoute, fieldsOf } from '../http/defineRoute.js';
import { signOut, signOutEverywhere, setDisplayName, isTranslator, needsDisplayName } from '../services/session.js';
import { cleanDisplayName } from '../domain/displayName.js';
import { deleteAccount } from '../services/deleteAccount.js';
import { addedPreviews } from '../services/added.js';
import { translatorList, markWelcomed, removeEntries, restoreEntries, setOptOut } from '../services/translator.js';
import { HUB_OFFSET_MAX, integer } from '../services/params.js';

/** `{ items }`: `{ kind, sourceId }[]`, checked by the translator service. @param {unknown} raw */
const itemsBody = (raw) => ({ items: fieldsOf(raw).items });

/** `{ name }`: a cleaned public name, or a 400 naming why not. @param {unknown} raw @returns {string} */
function nameBody(raw) {
  const { name } = fieldsOf(raw);
  const cleaned = cleanDisplayName(typeof name === 'string' ? name : '');
  if (!cleaned.ok) throw new BadRequest(cleaned.reason);
  return cleaned.name;
}

/** `{ confirm: 'delete' }`, or a 400. @param {unknown} raw */
function deleteBody(raw) {
  if (fieldsOf(raw).confirm !== 'delete') throw new BadRequest('confirm must be "delete"');
  return { confirm: 'delete' };
}

/** @param {import('../services/session.js').SessionUser|null} user */
function meUser(user) {
  if (!user) return null;
  return {
    via: user.via,
    handle: user.handle,
    displayName: user.displayName,
    isOwner: user.isOwner,
    isTranslator: isTranslator(user),
    needsName: needsDisplayName(user),
    showTranslatorWelcome: isTranslator(user) && !user.welcomedTranslator,
    isOptedOut: user.isOptedOut,
  };
}

export const meRoute = defineRoute({
  method: 'GET',
  path: '/api/me',
  auth: 'optional',
  cache: NO_STORE,
  query: [],
  run: async ({ user }) => ({ user: meUser(user) }),
});

/**
 * The caller's own items, every review state, newest first (Task 12).
 * Per-user, so it is never shared or stored; `reviewState` lets the page
 * label a held or rejected entry.
 */
export const addedRoute = defineRoute({
  method: 'GET',
  path: '/api/me/added',
  auth: 'user',
  query: ['offset'],
  run: async ({ query, user }, deps) => addedPreviews(deps, user.id, { offset: integer('offset', query.offset, HUB_OFFSET_MAX, 0) }),
});

/** The translator's own entries, every review state, removed ones flagged. */
export const translationsRoute = defineRoute({
  method: 'GET',
  path: '/api/me/translations',
  auth: 'user',
  query: ['offset'],
  run: async ({ query, user }, deps) => translatorList(deps, user, { offset: integer('offset', query.offset, HUB_OFFSET_MAX, 0) }),
});

/**
 * Removes the caller's own entries: `{ items: [{ kind, sourceId }] }`.
 * All or nothing, 1 to 50 per request.
 */
export const removeEntriesRoute = defineRoute({
  method: 'POST',
  path: '/api/me/translations/remove',
  auth: 'user',
  limit: 'remove',
  body: itemsBody,
  run: async ({ body, user }, deps) => removeEntries(deps, user, body.items),
});

/** Restores entries the caller removed themselves; owner hides stay hidden. */
export const restoreEntriesRoute = defineRoute({
  method: 'POST',
  path: '/api/me/translations/restore',
  auth: 'user',
  limit: 'restore',
  body: itemsBody,
  run: async ({ body, user }, deps) => restoreEntries(deps, user, body.items),
});

/**
 * Opts the caller's X accounts out of the archive (or back in): no
 * soft delete, just `accounts.opted_out_at`, which every public query
 * already respects.
 */
export const optOutRoute = defineRoute({
  method: 'POST',
  path: '/api/me/translations/opt-out',
  auth: 'user',
  limit: 'optOut',
  run: async ({ user }, deps) => setOptOut(deps, user, true),
});

/** Clears the opt-out; the account's entries become visible again. */
export const optInRoute = defineRoute({
  method: 'POST',
  path: '/api/me/translations/opt-in',
  auth: 'user',
  limit: 'optIn',
  run: async ({ user }, deps) => {
    if (user.translatorAccountIds.length === 0) throw new BadRequest('not_a_translator');
    return setOptOut(deps, user, false);
  },
});

/** Marks the one-time translator welcome as shown. Idempotent. */
export const welcomedRoute = defineRoute({
  method: 'POST',
  path: '/api/me/welcomed',
  auth: 'user',
  limit: 'welcome',
  run: async ({ user }, deps) => {
    if (isTranslator(user)) await markWelcomed(deps, user.id);
    return { ok: true };
  },
});

export const setNameRoute = defineRoute({
  method: 'POST',
  path: '/api/me/name',
  auth: 'user',
  limit: 'setName',
  body: nameBody,
  run: async ({ body: name, user }, deps) => {
    await setDisplayName(deps, user.id, name);
    return { ok: true, name };
  },
});

export const signOutRoute = {
  method: 'POST',
  path: '/api/auth/signout',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {import('../http/deps.js').Deps} deps */
  run: async (input, deps) => jsonWithCookies({ ok: true }, [await signOut(deps, input)]),
};

export const signOutAllRoute = defineRoute({
  method: 'POST',
  path: '/api/auth/signout-all',
  auth: 'user',
  run: async (ctx, deps) => {
    await signOutEverywhere(deps, ctx.user.id);
    return jsonWithCookies({ ok: true }, [await signOut(deps, ctx)]);
  },
});

export const deleteAccountRoute = defineRoute({
  method: 'POST',
  path: '/api/me/delete',
  auth: 'user',
  limit: 'deleteAccount',
  body: deleteBody,
  run: async ({ user }, deps) => jsonWithCookies({ ok: true }, [await deleteAccount(deps, user.id)]),
});
