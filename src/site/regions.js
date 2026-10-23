// @ts-check
/**
 * The Vercel regions a site may deploy its function to (`site.json`'s
 * `region`, written into `vercel.json`'s `regions` by the build).
 *
 * Source: Vercel, "Global network and regions", Region list
 * (https://vercel.com/docs/regions, page last updated 2026-08-11,
 * checked 2026-10-23): 19 compute-capable regions. `dev1` (the `vercel
 * dev` pseudo-region on that page) is left out: it isn't a deploy
 * target. Choose the one nearest your database (and your fans): the page
 * recommends running functions in, or as close as possible to, the
 * database's region.
 */
export const ALLOWED_REGIONS = Object.freeze([
  'arn1', 'bom1', 'cdg1', 'cle1', 'cpt1', 'dub1', 'fra1', 'gru1', 'hkg1', 'hnd1',
  'iad1', 'icn1', 'kix1', 'lhr1', 'pdx1', 'sfo1', 'sin1', 'syd1', 'yul1',
]);
