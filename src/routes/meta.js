// @ts-check
import { NOT_FOUND_CACHE, PUBLIC_CACHE } from '../http/handler.js';
import { withCacheTags } from '../http/cacheTags.js';
import { eventMetaPage, itemMetaPage } from '../services/meta.js';

/**
 * The page, cached as briefly as a 404 when it carries the generic meta
 * of a hidden or missing target (so a newly visible one gets its preview
 * within a minute); the handler keeps that shorter cache for a GET.
 * @param {{ html: string, found: boolean, tags: string[] }} page
 */
const htmlResponse = ({ html, found, tags }) => withCacheTags(new Response(html, {
  headers: { 'content-type': 'text/html; charset=utf-8', ...(found ? {} : { 'cache-control': NOT_FOUND_CACHE }) },
}), found ? tags ?? [] : []);

/**
 * A merged-away event's page: a 308, like `src/pages.js`'s `redirects`
 * (`permanent: true`). The route's own cache applies (`toResponse`), and
 * the tags let a purge of either event reach it.
 * @param {import('../services/meta.js').MetaRedirect} page
 */
const redirectResponse = ({ redirect, tags }) => withCacheTags(new Response(null, { status: 308, headers: { location: redirect } }), tags);

/** @typedef {import('../services/meta.js').MetaPage | import('../services/meta.js').MetaRedirect} RenderedPage */

/**
 * One link-preview meta route on a page path. Shared links carry
 * tracking params (`?s=20`), so any query is accepted and ignored.
 * @param {string} path
 * @param {(input: import('../http/handler.js').RouteInput, deps: import('../http/deps.js').Deps) => Promise<RenderedPage>} render
 */
const metaRoute = (path, render) => ({
  method: 'GET',
  path,
  cache: PUBLIC_CACHE,
  query: null,
  /** @param {import('../http/handler.js').RouteInput} input @param {import('../http/deps.js').Deps} deps */
  run: async (input, deps) => {
    const page = await render(input, deps);
    return 'redirect' in page ? redirectResponse(page) : htmlResponse(page);
  },
});

/**
 * The renderer each `src/pages.js` `meta` name stands for. `event` reads
 * the page path's `:date/:tag` (the slug `<date>/<tag>`).
 * @type {Record<string, (input: import('../http/handler.js').RouteInput, deps: import('../http/deps.js').Deps) => Promise<RenderedPage>>}
 */
const PAGE_META = {
  event: ({ params, origin }, deps) => eventMetaPage(deps, { slug: `${params.date}/${params.tag}`, origin }),
};

/**
 * The link-preview meta routes, on the original page paths: Vercel hands
 * the function the URL the browser asked for (`/t/123`, not a rewritten
 * one), so these match `/e/:date/:tag` and `<urlPrefix>:sourceId` directly.
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
