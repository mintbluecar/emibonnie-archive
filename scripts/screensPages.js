// @ts-check
/**
 * The pure parts of `npm run screens` (scripts/screens.js, Styling system
 * Task 7): which pages a role sees, and where a screenshot lands. Split
 * out of screens.js so the gallery's I/O (spawning the server, driving a
 * browser) stays separate from what test/scripts/screens.test.js exercises
 * with a stub `api`.
 */
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
