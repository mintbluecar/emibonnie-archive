// @ts-check
/**
 * The owner's API until Plan 3's admin (Plan 2b): `GET /api/owner` (the
 * switch, the sign-in alert, the waiting list, the reports), the approval
 * toggle, and publishing or rejecting one held entry. Every route here is
 * owner-only; a member is 403 and a signed-out visitor is 401.
 */
import { NO_STORE, PRIVATE_NO_STORE } from '../http/handler.js';
import { requireOwner } from '../services/session.js';
import { limit } from '../services/limits.js';
import { ownerView, setApproval, reviewItem, hideReportTarget, restoreReportTarget, dismissReport } from '../services/owner.js';
import { searchUsers, setBlocked, clearSignInAlert } from '../services/ownerUsers.js';

export const ownerRoute = {
  method: 'GET',
  path: '/api/owner',
  cache: PRIVATE_NO_STORE,
  query: [],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    await requireOwner(deps, input);
    return ownerView(deps);
  },
};

export const approvalRoute = {
  method: 'POST',
  path: '/api/owner/approval',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireOwner(deps, input);
    await limit(deps, 'owner', user.id);
    const required = /** @type {any} */ (input.body)?.required;
    return setApproval(deps, required === true, user.id);
  },
};

export const reviewRoute = {
  method: 'POST',
  path: '/api/owner/items/:kind/:sourceId/review',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireOwner(deps, input);
    await limit(deps, 'owner', user.id);
    const body = /** @type {any} */ (input.body);
    return reviewItem(deps, { kind: input.params.kind, sourceId: input.params.sourceId, state: body?.state, actor: user });
  },
};

/**
 * The three report actions: hide what a report names (the report stays
 * open so its row can offer restore), undo that hide, or just close.
 */
export const hideReportRoute = {
  method: 'POST',
  path: '/api/owner/reports/:id/hide',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireOwner(deps, input);
    await limit(deps, 'owner', user.id);
    return hideReportTarget(deps, { reportId: Number(input.params.id), actor: user });
  },
};

export const restoreReportRoute = {
  method: 'POST',
  path: '/api/owner/reports/:id/restore',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireOwner(deps, input);
    await limit(deps, 'owner', user.id);
    return restoreReportTarget(deps, { reportId: Number(input.params.id), actor: user });
  },
};

export const dismissReportRoute = {
  method: 'POST',
  path: '/api/owner/reports/:id/dismiss',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireOwner(deps, input);
    await limit(deps, 'owner', user.id);
    return dismissReport(deps, { reportId: Number(input.params.id), actor: user });
  },
};

/** Users search, by handle or chosen name; two characters minimum. */
export const usersRoute = {
  method: 'GET',
  path: '/api/owner/users',
  cache: PRIVATE_NO_STORE,
  query: ['q'],
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    await requireOwner(deps, input);
    return { users: await searchUsers(deps, input.query.q) };
  },
};

/** `{ userId }`: hides that submitter's live items and stops them writing. */
export const blockUserRoute = {
  method: 'POST',
  path: '/api/owner/users/block',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireOwner(deps, input);
    await limit(deps, 'owner', user.id);
    return setBlocked(deps, { userId: String(/** @type {any} */ (input.body)?.userId ?? ''), blocked: true, actor: user });
  },
};

/** `{ userId }`: restores only what the block hid. */
export const unblockUserRoute = {
  method: 'POST',
  path: '/api/owner/users/unblock',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireOwner(deps, input);
    await limit(deps, 'owner', user.id);
    return setBlocked(deps, { userId: String(/** @type {any} */ (input.body)?.userId ?? ''), blocked: false, actor: user });
  },
};

/** Clears the "an X sign-in failed" note. */
export const signInAlertRoute = {
  method: 'POST',
  path: '/api/owner/sign-in-alert/dismiss',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const user = await requireOwner(deps, input);
    await limit(deps, 'owner', user.id);
    return clearSignInAlert(deps, user.id);
  },
};
