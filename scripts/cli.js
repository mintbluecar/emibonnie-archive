// @ts-check
/**
 * `runCli`: the one place a CLI script picks its database, its site
 * directory, parses its own arguments, always ends the db, and prints
 * only a safe summary of a failure -- never a connection string.
 *
 * A script's `main()` wraps just this; its testable core (`runMigrate`,
 * `runAdd`, `runSetup`, ...) keeps its own signature, called from inside
 * `runCli`'s callback.
 */
import { parseArgs } from 'node:util';
import { createDb, dbOptionsFromEnv } from '../src/db/client.js';

/** @typedef {import('../src/db/common.js').Db} Db */

/**
 * `<SITE_DIR>`, or `site`. The one place every script reads it.
 * @param {Record<string, string|undefined>} env
 * @returns {string}
 */
export function siteDirOf(env) {
  return env.SITE_DIR ?? 'site';
}

/**
 * Where a required-db CLI writes: the env's `DATABASE_URL` (always, when
 * deployed) or a local PGlite directory (`PGLITE_DIR`). With neither it
 * refuses, rather than running against a throwaway in-memory database
 * and reporting success.
 * @param {Record<string, string|undefined>} env
 * @returns {{ url?: string, dir?: string }}
 */
export function dbTargetOf(env) {
  if (!env.DATABASE_URL && !env.PGLITE_DIR) throw new Error('DATABASE_URL is not set (set PGLITE_DIR to migrate a local dev database)');
  return dbOptionsFromEnv(env);
}

/**
 * The one line printed for a failed run: the error's message, else its
 * code, else a generic line. Never the connection string.
 * @param {any} err
 * @returns {string}
 */
export function errorText(err) {
  return err?.message || err?.code || 'database connection failed';
}

/**
 * @typedef {object} CliContext
 * @property {Db | undefined} db
 * @property {string} siteDir
 * @property {Record<string, undefined | string | boolean | (string|boolean)[]>} values
 * @property {(string|undefined)[]} positionals
 * @property {(line: string) => void} log
 * @property {Record<string, string|undefined>} env
 */

/**
 * `process.argv.slice(2)`, parsed against `optionsConfig` (strict: an
 * unknown or mistyped flag throws, same as every script's own `parseArgs`
 * call did before it moved here), or -- with no `optionsConfig` -- left
 * unparsed, as positionals, for the script's own `parseArgs` call (inside
 * its testable core, e.g. `runAdd`) to validate instead. One parse per
 * script, never two.
 * @param {import('node:util').ParseArgsOptionsConfig | undefined} optionsConfig
 * @returns {{ values: CliContext['values'], positionals: CliContext['positionals'] }}
 */
function parseOwnArgs(optionsConfig) {
  if (!optionsConfig) return { values: {}, positionals: process.argv.slice(2) };
  return parseArgs({ args: process.argv.slice(2), options: optionsConfig, allowPositionals: true });
}

/**
 * Runs one CLI entry point: resolves its database (`'required'` refuses
 * a throwaway in-memory one; `'none'` never opens one) and its site
 * directory, parses `process.argv` (only when `options.args` is given --
 * see `parseOwnArgs`), calls `main(ctx)`, always ends the db, and -- on a
 * throw, including an unknown flag -- prints `errorText(err)` and sets
 * `process.exitCode = 1` rather than the raw error.
 * @param {(ctx: CliContext) => Promise<unknown>} main
 * @param {{ db?: 'required' | 'none', args?: import('node:util').ParseArgsOptionsConfig }} [options]
 * @returns {Promise<void>}
 */
export async function runCli(main, options = {}) {
  const env = process.env;
  /** @type {Db | undefined} */
  let db;
  try {
    const { values, positionals } = parseOwnArgs(options.args);
    if ((options.db ?? 'required') === 'required') db = createDb(dbTargetOf(env));
    await main({ db, siteDir: siteDirOf(env), values, positionals, log: console.log, env });
  } catch (/** @type {any} */ err) {
    console.error(errorText(err));
    process.exitCode = 1;
  } finally {
    if (db) await db.end();
  }
}
