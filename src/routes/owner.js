// @ts-check
/**
 * The owner's API until Plan 3's admin (Plan 2b): `GET /api/owner` (the
 * switch, the sign-in alert, the waiting list, the reports), the approval
 * toggle, and publishing or rejecting one held entry. Every route here is
 * owner-only (`defineRoute`'s `auth: 'owner'`): a member is 403 and a
 * signed-out visitor is 401. Every write counts against the `owner` limit.
 */
import { BadRequest } from '../http/errors.js';
import { defineRoute, fieldsOf } from '../http/defineRoute.js';
import { ownerView, setApproval, reviewItem, hideReportTarget, restoreReportTarget, dismissReport } from '../services/owner.js';
import { searchUsers, setBlocked, clearSignInAlert } from '../services/ownerUsers.js';

/** `{ required }`: only `true` turns approval on. @param {unknown} raw */
const approvalBody = (raw) => ({ required: fieldsOf(raw).required === true });

/** `{ state }`: published or rejected. @param {unknown} raw @returns {{ state: 'published'|'rejected' }} */
function reviewBody(raw) {
  const { state } = fieldsOf(raw);
  if (state !== 'published' && state !== 'rejected') throw new BadRequest('state must be published or rejected');
  return { state };
}

/** `{ userId }`, as a string (empty when missing). @param {unknown} raw */
const userIdBody = (raw) => ({ userId: String(fieldsOf(raw).userId ?? '') });

export const ownerRoute = defineRoute({
  method: 'GET',
  path: '/api/owner',
  auth: 'owner',
  query: [],
  run: async (_ctx, deps) => ownerView(deps),
});

export const approvalRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/approval',
  auth: 'owner',
  limit: 'owner',
  body: approvalBody,
  run: async ({ body, user }, deps) => setApproval(deps, body.required, user.id),
});

export const reviewRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/items/:kind/:sourceId/review',
  auth: 'owner',
  limit: 'owner',
  body: reviewBody,
  run: async ({ params, body, user }, deps) => reviewItem(deps, { kind: params.kind, sourceId: params.sourceId, state: body.state, actor: user }),
});

/**
 * The three report actions: hide what a report names (the report stays
 * open so its row can offer restore), undo that hide, or just close.
 */
export const hideReportRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/reports/:id/hide',
  auth: 'owner',
  limit: 'owner',
  run: async ({ params, user }, deps) => hideReportTarget(deps, { reportId: Number(params.id), actor: user }),
});

export const restoreReportRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/reports/:id/restore',
  auth: 'owner',
  limit: 'owner',
  run: async ({ params, user }, deps) => restoreReportTarget(deps, { reportId: Number(params.id), actor: user }),
});

export const dismissReportRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/reports/:id/dismiss',
  auth: 'owner',
  limit: 'owner',
  run: async ({ params, user }, deps) => dismissReport(deps, { reportId: Number(params.id), actor: user }),
});

/** Users search, by handle or chosen name; two characters minimum. */
export const usersRoute = defineRoute({
  method: 'GET',
  path: '/api/owner/users',
  auth: 'owner',
  query: ['q'],
  run: async ({ query }, deps) => ({ users: await searchUsers(deps, query.q) }),
});

/** `{ userId }`: hides that submitter's live items and stops them writing. */
export const blockUserRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/users/block',
  auth: 'owner',
  limit: 'owner',
  body: userIdBody,
  run: async ({ body, user }, deps) => setBlocked(deps, { userId: body.userId, blocked: true, actor: user }),
});

/** `{ userId }`: restores only what the block hid. */
export const unblockUserRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/users/unblock',
  auth: 'owner',
  limit: 'owner',
  body: userIdBody,
  run: async ({ body, user }, deps) => setBlocked(deps, { userId: body.userId, blocked: false, actor: user }),
});

/** Clears the "an X sign-in failed" note. */
export const signInAlertRoute = defineRoute({
  method: 'POST',
  path: '/api/owner/sign-in-alert/dismiss',
  auth: 'owner',
  limit: 'owner',
  run: async ({ user }, deps) => clearSignInAlert(deps, user.id),
});
