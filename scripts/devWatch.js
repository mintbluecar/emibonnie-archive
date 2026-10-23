// @ts-check
/**
 * `npm run dev:watch` (or `npm run dev -- --watch`), Task 10c (i): builds,
 * serves the build (`scripts/dev.js`, as a child process), and rebuilds
 * whenever a file under `src/html`, `src/styles`, `public/js` or the
 * active site folder (`SITE_DIR`, default `site`) changes, then restarts
 * the server on the fresh build. Refresh the browser to see it.
 *
 * Changes are collected for `DEBOUNCE_MS` before a build starts, and a
 * build never runs twice at once: a change during a build queues exactly
 * one more after it. A failed build is reported and the last good server
 * keeps running. Files the build itself writes (the generated
 * `_registry.js` registries) are ignored, so a build never triggers the
 * next one.
 *
 * `fs.watch` with `recursive: true` (Node docs, fs.watch: "Indicates
 * whether all subdirectories should be watched"; supported on macOS and
 * Windows, and on Linux since Node 20 -- this repo needs Node 22).
 */
import { watch } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEBOUNCE_MS = 150;
const IGNORED = /(^|[\\/])_registry\.js$/;

/**
 * Debounced, never-overlapping rebuilds. `trigger()` after any change;
 * `build()` runs at most once at a time, and a trigger while it runs
 * schedules one more run after it (not one per change).
 * @param {{ build: () => Promise<boolean>, onBuilt?: () => void, debounceMs?: number }} options
 *   `build` resolves `true` on success; `onBuilt` runs after each success.
 */
export function createRebuilder({ build, onBuilt = () => {}, debounceMs = DEBOUNCE_MS }) {
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  let running = false;
  let again = false;

  async function run() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      if (await build()) onBuilt();
    } finally {
      running = false;
      if (again) {
        again = false;
        void run();
      }
    }
  }

  return {
    trigger() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void run(); }, debounceMs);
    },
    /** Builds now (the first build), through the same no-overlap guard. */
    run,
    /** @returns {boolean} */
    isRunning: () => running,
  };
}

/** The folders watched: engine markup, styles and browser code, and the site. @param {string} siteDir @returns {string[]} */
export function watchedDirs(siteDir) {
  return ['src/html', 'src/styles', 'public/js', siteDir];
}

/** @param {string} script @param {string[]} [args] @returns {import('node:child_process').ChildProcess} */
function node(script, args = []) {
  return spawn(process.execPath, [script, ...args], { stdio: 'inherit', env: process.env });
}

/** Runs `npm run build`'s script once. @returns {Promise<boolean>} */
function buildOnce() {
  return new Promise((resolve) => {
    const child = node('scripts/build.js');
    child.on('exit', (code) => resolve(code === 0));
  });
}

export async function main() {
  const siteDir = process.env.SITE_DIR ?? 'site';
  /** @type {import('node:child_process').ChildProcess|null} */
  let server = null;
  const restart = () => {
    server?.kill();
    server = node('scripts/dev.js');
    console.log('dev:watch: serving the fresh build -- refresh the browser');
  };
  const rebuilder = createRebuilder({ build: buildOnce, onBuilt: restart });
  for (const dir of watchedDirs(siteDir)) {
    watch(dir, { recursive: true }, (_event, file) => {
      if (file && IGNORED.test(String(file))) return;
      console.log(`dev:watch: ${path.join(dir, String(file ?? ''))} changed`);
      rebuilder.trigger();
    });
  }
  process.on('SIGINT', () => { server?.kill(); process.exit(0); });
  await rebuilder.run();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
