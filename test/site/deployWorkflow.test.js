// @ts-check
/**
 * Task 9a fix round 1, C1: `vercel.json` is build output (gitignored), and
 * `vercel build` reads the project config before it runs any builder, so
 * every deploy job in the example Actions workflow must run `npm run build`
 * before `vercel build`/`vercel deploy`.
 *
 * No YAML dependency: the example's shape is fixed (two-space job keys
 * under `jobs:`, `- run:` steps or `run:` lines under named steps), so its
 * steps are read line by line, in order.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const WORKFLOW = 'docs/deploy-workflow.example.yml';

/**
 * Each job's `run:` commands, in order.
 * @param {string} text @returns {Map<string, string[]>}
 */
export function jobRuns(text) {
  /** @type {Map<string, string[]>} */
  const jobs = new Map();
  let inJobs = false;
  /** @type {string[]|null} */
  let current = null;
  for (const line of text.split('\n')) {
    if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
    if (!inJobs) continue;
    if (/^\S/.test(line)) { inJobs = false; current = null; continue; }
    const job = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (job) { current = []; jobs.set(job[1], current); continue; }
    const run = /^\s+(?:- )?run:\s*(.+)$/.exec(line);
    if (run && current) current.push(run[1].trim());
  }
  return jobs;
}

test('every job that runs vercel build or vercel deploy runs npm run build first', () => {
  const jobs = jobRuns(readFileSync(WORKFLOW, 'utf8'));
  const deploying = [...jobs].filter(([, runs]) => runs.some((r) => /\bvercel(?:@\S+)? (?:build|deploy)\b/.test(r)));
  assert.deepEqual(deploying.map(([name]) => name).sort(), ['preview', 'production']);
  for (const [name, runs] of deploying) {
    const build = runs.indexOf('npm run build');
    const vercel = runs.findIndex((r) => /\bvercel(?:@\S+)? (?:build|deploy)\b/.test(r));
    assert.ok(build !== -1 && build < vercel, `${name}: npm run build must come before ${runs[vercel]} (got ${runs.join(' | ')})`);
  }
});

test('jobRuns reads named and bare run steps, per job', () => {
  const sample = 'on: push\njobs:\n  a:\n    steps:\n      - run: npm ci\n      - name: x\n        run: npm run build\n  b:\n    steps:\n      - run: vercel build\n';
  assert.deepEqual([...jobRuns(sample)], [['a', ['npm ci', 'npm run build']], ['b', ['vercel build']]]);
});
