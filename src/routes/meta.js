// @ts-check
import { NOT_FOUND_CACHE, PUBLIC_CACHE } from '../http/handler.js';
import { eventMetaPage, itemMetaPage } from '../services/meta.js';

/**
 * The page, cached as briefly as a 404 when it carries the generic meta
 * of a hidden or missing target (so a newly visible one gets its preview
 * within a minute); the handler keeps that shorter cache for a GET.
 * @param {{ html: string, found: boolean }} page
 */
const htmlResponse = ({ html, found }) => new Response(html, {
  headers: { 'content-type': 'text/html; charset=utf-8', ...(found ? {} : { 'cache-control': NOT_FOUND_CACHE }) },
});

/**
 * One link-preview meta route on a page path. Shared links carry
 * tracking params (`?s=20`), so any query is accepted and ignored.
 * @param {string} path
 * @param {(input: import('../http/handler.js').RouteInput, deps: any) => Promise<{ html: string, found: boolean }>} render
 */
const metaRoute = (path, render) => ({
  method: 'GET',
  path,
  cache: PUBLIC_CACHE,
  query: null,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async (input, deps) => htmlResponse(await render(input, deps)),
});

/**
 * The renderer each `src/pages.js` `meta` name stands for. `event` reads
 * the page path's `:slug`.
 * @type {Record<string, (input: import('../http/handler.js').RouteInput, deps: any) => Promise<{ html: string, found: boolean }>>}
 */
const PAGE_META = {
  event: ({ params, origin }, deps) => eventMetaPage(deps, { slug: params.slug, origin }),
};

/**
 * The link-preview meta routes, on the original page paths: Vercel hands
 * the function the URL the browser asked for (`/t/123`, not a rewritten
 * one), so these match `/e/:slug` and `<urlPrefix>:sourceId` directly.
 * Derived from the one source of truth: each `src/pages.js` page with a
 * `meta` name, then each registered kind's `urlPrefix` (the item page).
 * A hidden or unknown target gets the generic site meta.
 * @param {import('../pages.js').PageRoute[]} pageList
 * @param {{ urlPrefix: string }[]} kinds
 */
export function metaRoutes(pageList, kinds) {
  const pageRoutes = pageList.flatMap((page) => {
    if (!page.meta) return [];
    const render = PAGE_META[page.meta];
    if (!render) throw new Error(`src/pages.js: ${page.path} names an unknown meta renderer '${page.meta}'`);
    return [metaRoute(page.path, render)];
  });
  const itemRoutes = kinds.map(({ urlPrefix }) => metaRoute(`${urlPrefix}:sourceId`, ({ params, origin }, deps) => (
    itemMetaPage(deps, { prefix: urlPrefix.slice(1, -1), sourceId: params.sourceId, origin })
  )));
  return [...pageRoutes, ...itemRoutes];
}
