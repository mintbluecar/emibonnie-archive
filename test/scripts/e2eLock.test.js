// @ts-check
/**
 * `.e2e-build.lock` (Task 9a fix round 1, M7): `npm run e2e` and
 * `npm run e2e:site` both build into this checkout, so each takes the
 * lock before its dev server builds and releases it in teardown.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { acquireE2eLock, releaseE2eLock } from '../../scripts/e2eLock.js';

/** @param {(lock: string) => void} fn */
function withLockPath(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fan-archive-lock-'));
  try { fn(path.join(dir, '.e2e-build.lock')); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const mine = `${process.pid}:token-a`;

test('the first run takes the lock; a second, while the first is alive, is refused with a clear message', () => {
  withLockPath((lock) => {
    acquireE2eLock(lock, mine);
    assert.equal(readFileSync(lock, 'utf8'), mine);
    assert.throws(() => acquireE2eLock(lock, `${process.pid}:token-b`), /another e2e run is building.*\.e2e-build\.lock/s);
  });
});

test('release removes only the lock this run holds', () => {
  withLockPath((lock) => {
    acquireE2eLock(lock, mine);
    releaseE2eLock(lock, `${process.pid}:someone-else`);
    assert.ok(existsSync(lock), "another run's token leaves it alone (a run that reused that run's server)");
    releaseE2eLock(lock, mine);
    assert.ok(!existsSync(lock));
    releaseE2eLock(lock, mine); // nothing to release: no error
  });
});

test('a lock left by a run whose process is gone is taken over', () => {
  withLockPath((lock) => {
    writeFileSync(lock, '2147483646:crashed-run');
    acquireE2eLock(lock, mine);
    assert.equal(readFileSync(lock, 'utf8'), mine);
  });
});
