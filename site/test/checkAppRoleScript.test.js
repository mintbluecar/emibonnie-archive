// @ts-check
/**
 * Offline tests for `site/scripts/check-app-role.sh`, run entirely through its
 * `--dry-run` flag: no database connection. Run with `node --test
 * site/test/`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = path.join(REPO_ROOT, 'site/scripts/check-app-role.sh');

const PREVIEW_URL = 'postgres://preview-user:preview-secret-token@ep-preview.example.neon.tech/db';
const PROD_URL = 'postgres://prod-user:prod-secret-token@ep-main.example.neon.tech/db';

/**
 * @param {string[]} args
 * @param {Record<string, string>} env
 * @returns {{ status: number, output: string }}
 */
function runDryRun(args, env) {
  try {
    const output = execFileSync('bash', [SCRIPT, ...args, '--dry-run'], {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH ?? '', ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (/** @type {any} */ err) {
    return { status: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

test('refuses when no database URL is available at all', () => {
  const { status, output } = runDryRun([], {});
  assert.notEqual(status, 0);
  assert.match(output, /neither \$DATABASE_URL nor \$EMIBONNIE_DB_PREVIEW is set/);
});

test('accepts an inherited DATABASE_URL (how deploy.sh calls this script), without needing EMIBONNIE_DB_PREVIEW', () => {
  const { status, output } = runDryRun([], { DATABASE_URL: PREVIEW_URL });
  assert.equal(status, 0);
  assert.match(output, /pg_has_role/);
});

test('preview dry run announces the exact least-privilege query and the all-false requirement', () => {
  const { status, output } = runDryRun([], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.equal(status, 0);
  assert.match(output, /pg_has_role\('app','neon_superuser','member'\)/);
  assert.match(output, /has_table_privilege\('app','audit_log','update'\)/);
  assert.match(output, /has_table_privilege\('app','audit_log','delete'\)/);
  assert.match(output, /fail unless all three are f/);
});

test('--prod dry run targets the production branch', () => {
  const { status, output } = runDryRun(['--prod'], { EMIBONNIE_DB: PROD_URL });
  assert.equal(status, 0);
  assert.match(output, /\[check-app-role:production\]/);
});

test('never prints a database URL', () => {
  const { output } = runDryRun([], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.doesNotMatch(output, /preview-secret-token/);
  assert.doesNotMatch(output, /postgres:\/\//);
});

test('rejects an unknown argument before doing anything', () => {
  const { status, output } = runDryRun(['--nonsense'], { EMIBONNIE_DB_PREVIEW: PREVIEW_URL });
  assert.notEqual(status, 0);
  assert.match(output, /unknown argument/);
});
