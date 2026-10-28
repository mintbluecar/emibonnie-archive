// @ts-check
/**
 * Settings the web layer reads. Routes may not import `repo` directly, so
 * this is their one door to the settings table (the repo owns storage).
 */
export { approvalRequired as isApprovalRequired } from '../repo/settings.js';
