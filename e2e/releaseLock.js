// @ts-check
/** `npm run e2e:site`'s `globalTeardown`: releases this run's `.e2e-build.lock` (scripts/e2eLock.js). */
import { E2E_LOCK_PATH, releaseE2eLock } from '../scripts/e2eLock.js';

export default async function releaseLock() {
  releaseE2eLock(E2E_LOCK_PATH, process.env.E2E_LOCK_TOKEN);
}
