// @ts-check
/**
 * The signed-in user's own interface: `GET /api/me` (who am I?), `GET
 * /api/me/added` (the items they submitted, every review state), `POST
 * /api/me/name` (a Google user picks their public name), `POST
 * /api/auth/signout` and `/api/auth/signout-all`.
 */
import { NO_STORE, PRIVATE_NO_STORE } from '../http/handler.js';
import { BadRequest } from '../http/errors.js';
import { jsonWithCookies } from '../http/cookies.js';
import { currentUser, requireUser, signOut, signOutEverywhere, setDisplayName, isTranslator, needsDisplayName } from '../services/session.js';
import { limit } from '../services/limits.js';
import { cleanDisplayName } from '../domain/displayName.js';
import { deleteAccount } from '../services/deleteAccount.js';
import { addedPreviews } from '../services/added.js';
import { translatorList, markWelcomed, removeEntries, restoreEntries, setOptOut } from '../services/translator.js';
import { HUB_OFFSET_MAX, integer } from '../services/params.js';

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

export const meRoute = {
  method: 'GET',
  path: '/api/me',
  cache: NO_STORE,
  query: [],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => ({ user: meUser(await currentUser(deps, input)) }),
};

/**
 * The caller's own items, every review state, newest first (Task 12).
 * Per-user, so it is never shared or stored; `reviewState` lets the page
 * label a held or rejected entry.
 */
export const addedRoute = {
  method: 'GET',
  path: '/api/me/added',
  cache: PRIVATE_NO_STORE,
  query: ['offset'],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    const offset = integer('offset', input.query.offset, HUB_OFFSET_MAX, 0);
    return addedPreviews(deps, user.id, { offset });
  },
};

/** The translator's own entries, every review state, removed ones flagged. */
export const translationsRoute = {
  method: 'GET',
  path: '/api/me/translations',
  cache: PRIVATE_NO_STORE,
  query: ['offset'],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    const offset = integer('offset', input.query.offset, HUB_OFFSET_MAX, 0);
    return translatorList(deps, user, { offset });
  },
};

/**
 * Removes the caller's own entries: `{ items: [{ kind, sourceId }] }`.
 * All or nothing, 1 to 50 per request.
 */
export const removeEntriesRoute = {
  method: 'POST',
  path: '/api/me/translations/remove',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    await limit(deps, 'remove', user.id);
    return removeEntries(deps, user, (/** @type {any} */ (input.body))?.items);
  },
};

/** Restores entries the caller removed themselves; owner hides stay hidden. */
export const restoreEntriesRoute = {
  method: 'POST',
  path: '/api/me/translations/restore',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    await limit(deps, 'restore', user.id);
    return restoreEntries(deps, user, (/** @type {any} */ (input.body))?.items);
  },
};

/**
 * Opts the caller's X accounts out of the archive (or back in): no
 * soft delete, just `accounts.opted_out_at`, which every public query
 * already respects.
 */
export const optOutRoute = {
  method: 'POST',
  path: '/api/me/translations/opt-out',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    await limit(deps, 'optOut', user.id);
    return setOptOut(deps, user, true);
  },
};

/** Clears the opt-out; the account's entries become visible again. */
export const optInRoute = {
  method: 'POST',
  path: '/api/me/translations/opt-in',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    await limit(deps, 'optOut', user.id);
    if (user.translatorAccountIds.length === 0) throw new BadRequest('not_a_translator');
    return setOptOut(deps, user, false);
  },
};

/** Marks the one-time translator welcome as shown. Idempotent. */
export const welcomedRoute = {
  method: 'POST',
  path: '/api/me/welcomed',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    if (isTranslator(user)) await markWelcomed(deps, user.id);
    return { ok: true };
  },
};

export const setNameRoute = {
  method: 'POST',
  path: '/api/me/name',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    await limit(deps, 'setName', user.id);
    const raw = typeof (/** @type {any} */ (input.body))?.name === 'string' ? (/** @type {any} */ (input.body)).name : '';
    const cleaned = cleanDisplayName(raw);
    if (!cleaned.ok) throw new BadRequest(cleaned.reason);
    await setDisplayName(deps, user.id, cleaned.name);
    return { ok: true, name: cleaned.name };
  },
};

export const signOutRoute = {
  method: 'POST',
  path: '/api/auth/signout',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => jsonWithCookies({ ok: true }, [await signOut(deps, input)]),
};

export const signOutAllRoute = {
  method: 'POST',
  path: '/api/auth/signout-all',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    await signOutEverywhere(deps, user.id);
    return jsonWithCookies({ ok: true }, [await signOut(deps, input)]);
  },
};

export const deleteAccountRoute = {
  method: 'POST',
  path: '/api/me/delete',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireUser(deps, input);
    await limit(deps, 'deleteAccount', user.id);
    const confirm = /** @type {any} */ (input.body)?.confirm;
    if (confirm !== 'delete') throw new BadRequest('confirm must be "delete"');
    const clear = await deleteAccount(deps, user.id);
    return jsonWithCookies({ ok: true }, [clear]);
  },
};
