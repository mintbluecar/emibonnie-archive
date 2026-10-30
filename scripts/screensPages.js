// @ts-check
/**
 * The parts of `npm run screens` (scripts/screens.js, Styling system
 * Task 7) that need no server and no browser: which pages a role sees,
 * where a screenshot lands, seeding one import job so the owner's
 * gallery has something at `/admin/imports/<id>`, and the static index
 * page itself. Split out of screens.js, which spawns the server and
 * drives the browser, so test/scripts/screens.test.js can exercise
 * `pagesFor`/`outPathFor` with a stub `api` and no server of their own.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Nested property access that never throws (`undefined` at the first
 * missing step), so one `?.` chain's branches land in this one small
 * function instead of inflating every caller's complexity count.
 * @param {any} obj @param {(string|number)[]} keys @returns {any}
 */
function dig(obj, keys) {
  let value = obj;
  for (const key of keys) {
    if (value == null) return undefined;
    value = value[key];
  }
  return value;
}

/**
 * A word to search for, from `item`'s opening lines (mirrors
 * e2e/site.spec.js's `searchWordOf`): the first whitespace-separated run
 * of 3+ letters or digits, else the first 3 characters of its text.
 * @param {any} item @returns {string|null}
 */
function searchWordOf(item) {
  const text = (item?.lines ?? []).map((/** @type {any} */ line) => line.text ?? '').join(' ');
  const word = text.split(/\s+/).map((/** @type {string} */ w) => w.replace(/[^\p{L}\p{N}]/gu, '')).find((/** @type {string} */ w) => [...w].length >= 3);
  if (word) return word;
  const letters = [...text.replace(/[^\p{L}\p{N}]/gu, '')];
  return letters.length >= 3 ? letters.slice(0, 3).join('') : null;
}

/**
 * The first event and its first item, as pages (mirrors
 * e2e/site.spec.js's `firstEventSlug`/`firstItem`): empty when the seed
 * has no event.
 * @param {(path: string) => Promise<any>} api
 * @returns {Promise<{ pages: {name: string, path: string}[], firstItem: any }>}
 */
async function eventAndItemPages(api) {
  const home = await api('/api/home');
  const slug = dig(home, ['months', 0, 'events', 0, 'slug']) ?? null;
  if (!slug) return { pages: [], firstItem: null };
  const pages = [{ name: 'first event', path: `/e/${encodeURIComponent(slug)}` }];
  const event = await api(`/api/event/${encodeURIComponent(slug)}`);
  const firstItem = dig(event, ['sections', 0, 'items', 0]) ?? null;
  if (firstItem) pages.push({ name: 'first item', path: firstItem.url });
  return { pages, firstItem };
}

/**
 * Every listed person's page (`/api/filters`), and the first translator's.
 * @param {(path: string) => Promise<any>} api
 * @returns {Promise<{name: string, path: string}[]>}
 */
async function peopleAndTranslatorPages(api) {
  const filters = await api('/api/filters');
  const people = (dig(filters, ['people']) ?? [])
    .filter((/** @type {any} */ p) => p.igHandle)
    .map((/** @type {any} */ p) => ({ name: `person ${p.igHandle}`, path: `/p/${encodeURIComponent(p.igHandle)}` }));
  const translator = dig(filters, ['accounts', 0, 'handle']);
  return translator ? [...people, { name: 'first translator', path: `/tl/${encodeURIComponent(translator)}` }] : people;
}

/**
 * The pages every role sees, discovered through the site's API like
 * e2e/site.spec.js: home, the first event and its first item, every
 * listed person, the first translator, a search, about, privacy,
 * takedown and a 404.
 * @param {(path: string) => Promise<any>} api
 * @returns {Promise<{ pages: {name: string, path: string}[], firstItem: any }>}
 */
async function commonPages(api) {
  const { pages: eventPages, firstItem } = await eventAndItemPages(api);
  const word = searchWordOf(firstItem);
  const pages = [
    { name: 'home', path: '/' },
    ...eventPages,
    ...(await peopleAndTranslatorPages(api)),
    { name: 'search', path: `/?q=${encodeURIComponent(word ?? 'a')}` },
    ...['about', 'privacy', 'takedown'].map((name) => ({ name, path: `/${name}` })),
    { name: '404', path: '/this-page-does-not-exist' },
  ];
  return { pages, firstItem };
}

/**
 * Owner-only pages: the first item's edit page, `/add`, and the newest
 * import job's review page when one exists (`GET /api/owner/imports`).
 * @param {(path: string) => Promise<any>} api @param {any} firstItem
 * @returns {Promise<{name: string, path: string}[]>}
 */
async function ownerPages(api, firstItem) {
  /** @type {{name: string, path: string}[]} */
  const pages = [];
  if (firstItem) pages.push({ name: 'edit', path: `/edit/${encodeURIComponent(firstItem.kind)}/${encodeURIComponent(firstItem.sourceId)}` });
  pages.push({ name: 'add', path: '/add' });
  const imports = await api('/api/owner/imports');
  const latest = dig(imports, ['jobs', 0]);
  if (latest) pages.push({ name: 'import review', path: `/admin/imports/${encodeURIComponent(String(latest.id))}` });
  return pages;
}

/**
 * The page list for `role`: the common pages every role gets, plus its
 * own (owner also gets the edit and import review pages; translator and
 * member get `/me`, member and owner also `/add`; guest visits `/me`
 * signed out, and gets nothing else owner-only).
 * @param {'owner'|'translator'|'member'|'guest'} role
 * @param {(path: string) => Promise<any>} api
 * @returns {Promise<{name: string, path: string}[]>}
 */
export async function pagesFor(role, api) {
  const { pages, firstItem } = await commonPages(api);
  if (role === 'owner') {
    pages.push({ name: 'me', path: '/me' }, ...(await ownerPages(api, firstItem)));
  } else if (role === 'member') {
    pages.push({ name: 'me', path: '/me' }, { name: 'add', path: '/add' });
  } else {
    pages.push({ name: role === 'guest' ? 'me (signed out)' : 'me', path: '/me' });
  }
  return pages;
}

/**
 * The screenshot's path under the gallery's output dir:
 * `<role>/<width>-<theme>/<name>.png`, `name` turned into a safe filename.
 * @param {string} role @param {number} width @param {'light'|'dark'} theme @param {string} name
 * @returns {string}
 */
export function outPathFor(role, width, theme, name) {
  const safe = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'page';
  return path.join(role, `${width}-${theme}`, `${safe}.png`);
}

/**
 * The `POST /api/dev/import` body (fix round 1, controller ruling) that
 * seeds one held import job from the site's own seed tweet ids, so the
 * owner gallery always includes `/admin/imports/<id>` -- or `null` when
 * the site has no `seed/maps.json` (or no tweets in it), nothing to
 * import from.
 * @param {string} siteDir
 * @returns {string[] | null}
 */
export function importJobUrls(siteDir) {
  const mapsPath = path.join(siteDir, 'seed', 'maps.json');
  if (!existsSync(mapsPath)) return null;
  const ids = Object.keys(JSON.parse(readFileSync(mapsPath, 'utf8')).tweets ?? {});
  return ids.length > 0 ? ids.map((id) => `https://x.com/i/status/${id}`) : null;
}

/** @param {string} text @returns {string} */
function escapeHtml(text) {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

/**
 * `map.get(key)`, setting it to a fresh `Map`/`[]` first when missing.
 * @template V @param {Map<string, V>} map @param {string} key @param {() => V} create @returns {V}
 */
function getOrCreate(map, key, create) {
  if (!map.has(key)) map.set(key, create());
  return /** @type {V} */ (map.get(key));
}

/**
 * The gallery's static index: every captured page, grouped by page name
 * then role, each role listing its viewport x theme shots. Opened straight
 * off disk -- relative links only, nothing external.
 * @param {{role: string, name: string, path: string, width: number, theme: string}[]} shots
 * @returns {string}
 */
export function buildIndexHtml(shots) {
  /** @type {Map<string, Map<string, {width: number, theme: string, path: string}[]>>} */
  const byPage = new Map();
  for (const shot of shots) {
    const byRole = getOrCreate(byPage, shot.name, () => new Map());
    const variants = getOrCreate(byRole, shot.role, () => []);
    variants.push(shot);
  }
  const sections = [...byPage.entries()].map(([name, byRole]) => {
    const roles = [...byRole.entries()].map(([role, variants]) => {
      const links = variants.map((v) => `<a href="${v.path}">${v.width}&times;${v.theme}</a>`).join(' ');
      return `<div class="role"><strong>${escapeHtml(role)}</strong> ${links}</div>`;
    }).join('\n');
    return `<section><h2>${escapeHtml(name)}</h2>${roles}</section>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Screen gallery</title>
<style>body{font-family:sans-serif;margin:2rem}section{margin-bottom:1.5rem}a{margin-right:0.75rem}</style>
</head><body><h1>Screen gallery</h1>${sections}</body></html>`;
}
