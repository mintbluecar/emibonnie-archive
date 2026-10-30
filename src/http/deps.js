// @ts-check
/**
 * `Deps`: the one object every route and service receives. `BaseDeps` is
 * what `api/index.js`'s `makeDeps` builds per request (and what tests
 * build in its place); `withDeps` (handler.js) adds `defer` to make the
 * full `Deps` a route's `run` sees. No index signature: a site that needs
 * a field not listed here adds it here first, with its one real caller.
 */

/** @typedef {import('../db/common.js').Db} Db */
/** @typedef {import('../site/schema.js').Site} Site */

/**
 * @typedef {object} BaseDeps
 * @property {Db} db
 * @property {typeof fetch} fetchImpl
 * @property {() => Date} now
 * @property {Site} site
 * @property {Record<string, string|undefined>} env
 * @property {{ dir: string, logo: string|null }} pages
 * @property {(tags: string|string[]) => Promise<void>} invalidateByTag
 * @property {(tags: string|string[], options?: { revalidationDeadlineSeconds?: number }) => Promise<void>} dangerouslyDeleteByTag
 */

/** @typedef {BaseDeps & { defer: (task: () => Promise<unknown>) => void }} Deps */

export {};
