// @ts-check
/**
 * `.e2e-build.lock` (Task 9a fix round 1, M7): `npm run e2e` (the bundled
 * example) and `npm run e2e:site` (the repo's own site) both build into
 * this checkout's `public/`, `src/site/generated.js` and `vercel.json`, so
 * two at once would build over each other. Each config's `webServer`
 * command takes the lock first (`node scripts/e2eLock.js`); its
 * `globalTeardown` releases it. Playwright starts the `webServer` before
 * any `globalSetup`, hence the command, not a setup file.
 *
 * The lock holds the run's token (`<pid of the Playwright CLI>:<random>`,
 * e2e/helpers.js's `e2eLockToken()`), so a run that reused another run's
 * already-running server never releases that run's lock, and a lock whose
 * pid is gone (a killed run) is taken over instead of blocking forever.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const E2E_LOCK_PATH = '.e2e-build.lock';

/** @param {string} token @returns {boolean} whether the token's process is still running */
function ownerAlive(token) {
  const pid = Number(token.split(':')[0]);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (/** @type {any} */ err) {
    return err.code === 'EPERM';
  }
}

/** @param {string} lockPath @returns {string|null} */
function holder(lockPath) {
  try {
    return readFileSync(lockPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Takes the lock for `token`, or throws while a live run holds it.
 * @param {string} lockPath @param {string} token
 */
export function acquireE2eLock(lockPath, token) {
  try {
    writeFileSync(lockPath, token, { flag: 'wx' });
    return;
  } catch (/** @type {any} */ err) {
    if (err.code !== 'EEXIST') throw err;
  }
  const current = holder(lockPath) ?? '';
  if (current !== token && ownerAlive(current)) {
    throw new Error(`another e2e run is building into this checkout (${lockPath} holds ${current}). ` +
      `Wait for it to finish, or delete ${lockPath} if no e2e run is active.`);
  }
  rmSync(lockPath, { force: true });
  writeFileSync(lockPath, token, { flag: 'wx' });
}

/**
 * Releases the lock if `token` holds it; anything else is left alone.
 * @param {string} lockPath @param {string|undefined} token
 */
export function releaseE2eLock(lockPath, token) {
  if (token && holder(lockPath) === token) rmSync(lockPath, { force: true });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const token = process.env.E2E_LOCK_TOKEN;
    if (!token) throw new Error('e2eLock: E2E_LOCK_TOKEN is not set (run through npm run e2e or npm run e2e:site)');
    acquireE2eLock(E2E_LOCK_PATH, token);
  } catch (/** @type {any} */ err) {
    console.error(err.message ?? String(err));
    process.exitCode = 1;
  }
}
