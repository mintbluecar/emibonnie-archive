// @ts-check
/** Task 10c (i): the dev watcher's rebuilds are debounced and never overlap. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createRebuilder, watchedDirs, buildOnce, createServerSupervisor } from '../../scripts/devWatch.js';

const wait = (/** @type {number} */ ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

test('a burst of changes is one build; a change during a build queues exactly one more, never a second at once', async () => {
  let concurrent = 0;
  let maxConcurrent = 0;
  let builds = 0;
  let served = 0;
  const rebuilder = createRebuilder({
    debounceMs: 10,
    onBuilt: () => { served += 1; },
    build: async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      builds += 1;
      await wait(40);
      concurrent -= 1;
      return true;
    },
  });
  for (let i = 0; i < 5; i += 1) rebuilder.trigger();
  await wait(25);
  assert.equal(builds, 1, 'five changes inside the debounce: one build');
  rebuilder.trigger();
  rebuilder.trigger();
  await wait(20);
  assert.equal(rebuilder.isRunning(), true, 'still in the first build when the debounced change fires');
  await wait(150);
  assert.equal(maxConcurrent, 1, 'never two builds at once');
  assert.equal(builds, 2, 'the changes during the first build make one more');
  assert.equal(served, 2);
  assert.equal(rebuilder.isRunning(), false);
});

test('a failed build serves nothing new', async () => {
  let served = 0;
  const rebuilder = createRebuilder({ debounceMs: 1, build: async () => false, onBuilt: () => { served += 1; } });
  await rebuilder.run();
  assert.equal(served, 0);
});

test('it watches the engine\'s markup, styles and browser code, and the active site folder', () => {
  assert.deepEqual(watchedDirs('examples/solluna'), ['src/html', 'src/styles', 'public/js', 'examples/solluna']);
});


/** A fake child process: `kill()` exits it after a tick, as a real one does. */
class FakeChild extends EventEmitter {
  constructor() { super(); this.exitCode = null; this.signalCode = null; this.killed = false; }
  kill() { this.killed = true; setTimeout(() => { this.signalCode = 'SIGTERM'; this.emit('exit', null, 'SIGTERM'); }, 20); return true; }
}

test('review M2: a restart waits for the old server to exit before starting the new one (no port race)', async () => {
  /** @type {string[]} */
  const log = [];
  /** @type {FakeChild[]} */
  const children = [];
  const supervisor = createServerSupervisor(/** @type {any} */ (() => {
    const child = new FakeChild();
    child.on('exit', () => log.push(`exit ${children.indexOf(child)}`));
    log.push(`start ${children.length}`);
    children.push(child);
    return child;
  }));
  await supervisor.restart();
  await supervisor.restart();
  assert.deepEqual(log, ['start 0', 'exit 0', 'start 1']);
  await supervisor.stop();
  assert.equal(children[1].killed, true);
});

test('review M2: a build child that fails to start resolves false, and the rebuilder is free again', async () => {
  const failing = new FakeChild();
  const result = buildOnce(/** @type {any} */ (() => { setTimeout(() => failing.emit('error', new Error('spawn ENOENT')), 0); return failing; }));
  assert.equal(await result, false);
  const rebuilder = createRebuilder({ debounceMs: 1, build: () => Promise.reject(new Error('boom')) });
  await rebuilder.run();
  assert.equal(rebuilder.isRunning(), false);
});
