// @ts-check
/**
 * `POST /api/reports`: the public report form. No sign-in; the handler's
 * Origin check applies, and the per-IP report limit lives in the service's
 * caller (src/services/limits.js `report`).
 */
import { NO_STORE } from '../http/handler.js';
import { currentUser } from '../services/session.js';
import { limit } from '../services/limits.js';
import { createReport } from '../services/reports.js';

export const route = {
  method: 'POST',
  path: '/api/reports',
  cache: NO_STORE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => {
    const reporter = await currentUser(deps, input);
    await limit(deps, 'report', input.ip);
    const body = /** @type {any} */ (input.body);
    return createReport(deps, { target: body?.target, reason: body?.reason, reporter });
  },
};
