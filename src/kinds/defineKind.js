// @ts-check
import { pages, redirects } from '../pages.js';

/**
 * The item-kind plugin contract. Generic code (ingest, search, hub views)
 * only ever talks to a kind through this shape, and reads only
 * `draft.common` and `draft.missing` from a draft; everything else on a
 * draft is the kind's own business, handed back to its `persist`.
 *
 * `platform` is the `platforms` code of the sources `matchesUrl` finds
 * (ingest checks a pasted id against what is archived before fetching).
 *
 * `followUpOf(input)` (optional) names the post a fetched input continues;
 * ingest attaches the input to the archived item owning that post, when
 * it's by the same credited account, through `appendFollowUp` (required
 * whenever `followUpOf` is given).
 *
 * Optional upkeep, for kinds whose sources can change after intake
 * (generic code calls each only when the kind defines it):
 * - `refresh(deps, itemId, { actor })` re-reads the item's sources whose
 *   edit window isn't finalized, takes any edit, and finalizes a source
 *   once its window has closed (or it's gone for good). The item page
 *   schedules it once a window has elapsed; the refresh route is a 404
 *   for a kind without it.
 * - `checkFollowUps(deps, itemId, { actor })` appends the item's later
 *   same-author follow-ups no item archives yet.
 *
 * @typedef {import('../domain/constants.js').Placement} Placement
 * @typedef {import('../domain/events.js').Event} Event
 * @typedef {import('../domain/events.js').EventPerson} EventPerson
 * @typedef {import('../domain/events.js').EventProposal} EventProposal
 * @typedef {import('../domain/constants.js').LiveTextPattern} LiveTextPattern
 * @typedef {import('../domain/speakers.js').SpeakerMap} SpeakerMap
 * @typedef {import('../domain/speakers.js').DefaultMarkers} DefaultMarkers
 * @typedef {{platform: string, externalId: string}} SourceRef
 * @typedef {{personId: number, role: 'present'|'sharing'|'about'|'author'}} ItemPerson
 *
 * @typedef {{
 *   placement?: Placement,
 *   eventId?: number,
 *   newEvent?: boolean,
 *   eventName?: string,
 *   categoryName?: string,
 *   clientName?: string,
 *   text?: string,
 *   occurredOn?: string,
 *   people?: { igHandle: string, role: ItemPerson['role'] }[],
 *   subbed?: boolean,
 *   lineFixes?: import('../domain/lineFixes.js').LineFix[],
 * }} DraftOverrides
 *   What the submitter changed in the add flow. `text` is text typed in by
 *   hand (it replaces the source's text and marks it `textEnteredManually`).
 *   `occurredOn` (`YYYY-MM-DD`) is read by ingest, not by `draft`: it
 *   supplies the date when the source gives none. `people` (also read by
 *   ingest, never by `draft`) adds known people to the item on top of the
 *   ones the draft derives, e.g. who a shared story is about when its
 *   speakers are only generic roles; each handle must already be a person.
 *
 * @typedef {{
 *   people: EventPerson[],
 *   personAccounts: {platform: string, handle: string, personId: number}[],
 *   events: Event[],
 *   ignoredHashtags: string[],
 *   livePatterns: LiveTextPattern[],
 *   defaultMarkers: DefaultMarkers,
 *   timezone: string,
 *   formatName: (name: string) => string,
 *   remembered: SpeakerMap,
 *   chosen: SpeakerMap,
 *   overrides: DraftOverrides,
 * }} DraftContext
 *   Everything `draft` may consult, loaded by the caller. `livePatterns` is
 *   the engine's list plus the site's compiled `extraLivePatterns`;
 *   `remembered` is the speaker memory for the credited account.
 *
 * @typedef {{
 *   placement: Placement,
 *   eventId: number|null,
 *   proposal: EventProposal|null,
 *   occurredOn: string|null,
 *   postedAt: string|null,
 *   credited: {platform: string, externalId: string|null, handle: string|null, displayName: string|null},
 *   primary: {platform: string, externalId: string, url: string},
 *   people: ItemPerson[],
 *   categoryName: string|null,
 *   clientName: string|null,
 *   textEnteredManually: boolean,
 *   followsOn: SourceRef|null,
 * }} DraftCommon
 *
 * @typedef {{marker: string, count: number}} MissingMarker
 * @typedef {{common: DraftCommon, missing: MissingMarker[], suggestions?: Event[], newTags?: string[]}} Draft
 *   `newTags` (kind-specific, optional): header tags that steered nothing
 *   -- generic code only passes it through for the add flow and the CLI
 *   to surface; it never blocks or decides placement.
 *
 * @typedef {{status: 'live'|'deleted'|'unavailable'}} SourceInput
 *   What `fetchSource` returns: the kind's own input for `draft`, with at
 *   least a `status` ingest can read.
 * @typedef {any} Db
 * @typedef {{ speakers: SpeakerMap, people: ItemPerson[], notes?: string[] }} RemapResult
 *   What `remapSpeakers` left on the item: its whole speaker map and
 *   people, plus `notes` for the owner (e.g. a marker matched only once a
 *   variation selector was added or dropped).
 * @typedef {{ db: Db, fetchImpl: typeof fetch, now?: () => Date }} UpkeepDeps
 * @typedef {{
 *   people: Map<number, import('../repo/people.js').Person>,
 *   formatName: (name: string) => string,
 *   urlFor: (kind: string, sourceId: string) => string,
 *   chips: (people: { personId: number }[]) => import('../http/contracts.js').PersonChip[],
 *   roleEmoji?: Partial<Record<import('../domain/constants.js').Role, string>>,
 * }} PresentContext
 *   What a presenter may consult, loaded once per request by the caller
 *   (src/services/cards.js): every known person by id, the site's name
 *   formatting, public URLs by kind, person chips for a card's people, and
 *   each generic role's default emoji (`ROLE_EMOJI` with the site's
 *   `roleEmoji` over it; a presenter falls back to `ROLE_EMOJI` without it).
 * @typedef {{
 *   name: string,
 *   table: string,
 *   urlPrefix: string,
 *   platform: string,
 *   matchesUrl(url: string): string|null,
 *   fetchSource(deps: any, sourceId: string): Promise<SourceInput>,
 *   followUpOf?: (input: any) => SourceRef|null,
 *   appendFollowUp?: (tx: Db, args: { itemId: number, accountId: number|null, input: any, pending: boolean }) => Promise<void>,
 *   draft(input: any, ctx: DraftContext): Draft,
 *   persist(tx: Db, draft: any, meta: object): Promise<number>,
 *   loadDetails(db: Db, itemIds: number[], options?: { includePending?: boolean }): Promise<Map<number, object>>,
 *   present: { preview(item: any, details: any, ctx: any): object, detail(item: any, details: any, ctx: any): object },
 *   search: { textClause(paramIndex: number): string, rank(paramIndex: number): string, matchLines(details: any, q: string, ctx?: any): string[] },
 *   refresh?: (deps: UpkeepDeps, itemId: number, options: { actor: string }) => Promise<{ updated: number, editableUntil: string|null }>,
 *   checkFollowUps?: (deps: UpkeepDeps, itemId: number, options: { actor: string }) => Promise<{ added: number }>,
 *   previewDraft?: (draft: any) => object,
 *   profileUrl?: (handle: string) => string,
 *   remapSpeakers?: (tx: Db, args: { itemId: number, map: SpeakerMap, ctx: DraftContext }) => Promise<RemapResult>,
 *   setLineFixes?: (tx: Db, args: { itemId: number, fixes: import('../domain/lineFixes.js').LineFix[] }) => Promise<void>,
 *   heldItemIds?: (db: Db, args: { limit: number }) => Promise<number[]>,
 *   reviewHeld?: (tx: Db, args: { itemId: number, approve: boolean }) => Promise<void>,
 *   setSubbed?: (tx: Db, args: { itemId: number, subbed: boolean }) => Promise<void>,
 * }} Kind
 *   `remapSpeakers(tx, …)` (optional, Task 10c): the owner's `npm run
 *   remap` for an archived item -- sets the given markers' speakers and
 *   updates the item's people the way intake derives them, inside the
 *   caller's transaction. Throws `BadRequest` for a marker the item's
 *   text never uses.
 *   `profileUrl(handle)` (optional): the kind's own public profile link
 *   for a credited handle (e.g. an X profile) -- `accountView`
 *   (src/services/hubs.js) sets `AccountView.account.profileUrl` from it
 *   when the kind defines one, so the translator page never hardcodes a
 *   platform itself.
 *   `previewDraft(draft)` (optional, Plan 2a Task 13): the extra fields
 *   the add form needs from a dry-run draft but that no saved row has yet
 *   -- today just the translation's pinned `media`. Ingest merges them
 *   into the `ready` result.
 *
 * `present.preview(card, details, ctx)` / `present.detail(card, details, ctx)`
 * build the `Preview` / `DetailVM` of src/http/contracts.js from a
 * `Card` (src/repo/cards.js), the kind's own `loadDetails` entry and the
 * caller's presenter context. `search.textClause(n)` is a SQL condition
 * on the item aliased `i` matching the bound `ilike` pattern `$n`;
 * `search.rank(n)` a SQL number expression scoring `i` against the bound
 * raw query `$n` (higher first); both interpolate only `n`.
 * `search.matchLines(details, q, ctx)` picks the lines a result shows; with
 * the presenter context, it shows speakers the way `present` does (e.g.
 * a person's standard emoji, never a translator's own marker).
 */

const NAME = /^[a-z][a-z0-9_]*$/;
const URL_PREFIX = /^\/[a-z0-9-]+\/$/;

/**
 * A page path's first segment as a `/x/` prefix (`'/e/:slug'` -> `'/e/'`),
 * or `null` for one with none (`'/'`).
 * @param {string} pagePath
 * @returns {string|null}
 */
function prefixOf(pagePath) {
  const first = pagePath.split('/').find(Boolean);
  return first ? `/${first}/` : null;
}

/**
 * Item-page prefixes no kind may take: every `src/pages.js` page's
 * prefix (the engine's own pages, including ones later Plan 1b tasks
 * still have to build), every redirected old page path's (`/search`,
 * Task 10d), plus the API. `/t/` belongs to the translation
 * kind alone (see `OWNED_URL_PREFIXES` below).
 */
export const RESERVED_URL_PREFIXES = Object.freeze([
  ...new Set([...pages.map((page) => page.path), ...redirects.map((r) => r.source)].map(prefixOf).filter((prefix) => prefix !== null)),
  '/api/',
]);
/** @type {Readonly<Record<string, string>>} prefix -> the one kind that owns it */
const OWNED_URL_PREFIXES = Object.freeze({ '/t/': 'translation' });
const REQUIRED_FUNCTIONS = ['matchesUrl', 'fetchSource', 'draft', 'persist', 'loadDetails'];
const REQUIRED_GROUPS = { present: ['preview', 'detail'], search: ['textClause', 'rank', 'matchLines'] };
const OPTIONAL_FUNCTIONS = ['refresh', 'checkFollowUps', 'previewDraft', 'profileUrl', 'remapSpeakers', 'setLineFixes', 'setSubbed', 'heldItemIds', 'reviewHeld'];

/**
 * Each string field of the spec, the pattern it must match, and the problem when it doesn't.
 * @type {[string, RegExp, string][]}
 */
const STRING_FIELDS = [
  ['name', NAME, 'name must match ^[a-z][a-z0-9_]*$'],
  ['table', NAME, 'table must match ^[a-z][a-z0-9_]*$'],
  ['urlPrefix', URL_PREFIX, 'urlPrefix must look like /x/'],
  ['platform', NAME, 'platform must be a platforms code'],
];

/**
 * @param {any} spec
 * @returns {string[]}
 */
function optionalProblems(spec) {
  return OPTIONAL_FUNCTIONS.filter((key) => spec[key] !== undefined && typeof spec[key] !== 'function')
    .map((key) => `${key} must be a function when given`);
}

/**
 * @param {any} spec
 * @returns {string[]}
 */
function followUpProblems(spec) {
  if (spec.followUpOf === undefined) return [];
  if (typeof spec.followUpOf !== 'function') return ['followUpOf must be a function when given'];
  return typeof spec.appendFollowUp === 'function' ? [] : ['appendFollowUp must be a function when followUpOf is given'];
}

/**
 * @param {any} spec
 * @returns {string[]}
 */
function shapeProblems(spec) {
  const bad = STRING_FIELDS.filter(([key, pattern]) => typeof spec[key] !== 'string' || !pattern.test(spec[key]));
  return [...bad.map(([, , problem]) => problem), ...prefixProblems(spec), ...followUpProblems(spec), ...optionalProblems(spec)];
}

/**
 * Why `prefix` (`/x/`) can't be `kindName`'s item-page prefix, or null
 * when it can: an engine page's or the API's (`RESERVED_URL_PREFIXES`),
 * or one another kind owns. The one check `defineKind` and the
 * scaffolder (`scripts/newPlans.js`) share. Pass no `kindName` to ask
 * whether any kind owns it (e.g. for a new page's path).
 * @param {string} prefix
 * @param {string} [kindName]
 * @returns {string|null}
 */
export function urlPrefixProblem(prefix, kindName) {
  if (RESERVED_URL_PREFIXES.includes(prefix)) return `urlPrefix ${prefix} is reserved by the engine`;
  const owner = Object.hasOwn(OWNED_URL_PREFIXES, prefix) ? OWNED_URL_PREFIXES[prefix] : undefined;
  return owner && owner !== kindName ? `urlPrefix ${prefix} belongs to the ${owner} kind` : null;
}

/**
 * @param {any} spec
 * @returns {string[]}
 */
function prefixProblems(spec) {
  const problem = urlPrefixProblem(spec.urlPrefix, spec.name);
  return problem ? [problem] : [];
}

/**
 * @param {any} spec
 * @returns {string[]}
 */
function missingFunctions(spec) {
  const grouped = Object.entries(REQUIRED_GROUPS).flatMap(([group, keys]) => keys.map((key) => [group, key]));
  const paths = [...REQUIRED_FUNCTIONS.map((key) => [key]), ...grouped];
  return paths
    .filter(([first, second]) => typeof (second ? spec[first]?.[second] : spec[first]) !== 'function')
    .map((path) => `${path.join('.')} must be a function`);
}

/**
 * @param {any} spec
 * @returns {string[]}
 */
function problemsOf(spec) {
  if (spec === null || typeof spec !== 'object') return ['spec must be an object'];
  return [...shapeProblems(spec), ...missingFunctions(spec)];
}

/**
 * Checks a kind's spec against the contract and returns it frozen
 * (including `present` and `search`). Throws listing every problem.
 * @param {Kind} spec
 * @returns {Readonly<Kind>}
 */
export function defineKind(spec) {
  const problems = problemsOf(spec);
  if (problems.length > 0) throw new TypeError(`invalid kind ${JSON.stringify(spec?.name)}: ${problems.join('; ')}`);
  return Object.freeze({ ...spec, present: Object.freeze({ ...spec.present }), search: Object.freeze({ ...spec.search }) });
}
