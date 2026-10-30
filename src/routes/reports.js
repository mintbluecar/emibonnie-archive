// @ts-check
/**
 * `POST /api/reports`: the public report form. No sign-in needed (a
 * signed-in reporter is recorded); the handler's Origin check applies, and
 * the `report` limit counts per IP (src/services/limits.js).
 */
import { defineRoute, fieldsOf } from '../http/defineRoute.js';
import { createReport } from '../services/reports.js';

/** `{ target, reason }`, checked by `createReport`. @param {unknown} raw */
function reportBody(raw) {
  const { target, reason } = fieldsOf(raw);
  return { target, reason };
}

export const route = defineRoute({
  method: 'POST',
  path: '/api/reports',
  auth: 'optional',
  limit: 'report',
  body: reportBody,
  run: async ({ body, user }, deps) => createReport(deps, { target: body.target, reason: body.reason, reporter: user }),
});
