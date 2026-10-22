// @ts-check

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
 *   categoryName?: string,
 *   clientName?: string,
 *   text?: string,
 *   occurredOn?: string,
 * }} DraftOverrides
 *   What the submitter changed in the add flow. `text` is text typed in by
 *   hand (it replaces the source's text and marks it `textEnteredManually`).
 *   `occurredOn` (`YYYY-MM-DD`) is read by ingest, not by `draft`: it
 *   supplies the date when the source gives none.
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
 * @typedef {{ db: Db, fetchImpl: typeof fetch, now?: () => Date }} UpkeepDeps
 * @typedef {{
 *   people: Map<number, import('../repo/people.js').Person>,
 *   formatName: (name: string) => string,
 *   urlFor: (kind: string, sourceId: string) => string,
 *   chips: (people: { personId: number }[]) => import('../http/contracts.js').PersonChip[],
 * }} PresentContext
 *   What a presenter may consult, loaded once per request by the caller
 *   (src/services/cards.js): every known person by id, the site's name
 *   formatting, public URLs by kind, and person chips for a card's people.
 * @typedef {{
 *   name: string,
 *   table: string,
 *   urlPrefix: string,
 *   platform: string,
 *   matchesUrl(url: string): string|null,
 *   fetchSource(deps: any, sourceId: string): Promise<SourceInput>,
 *   followUpOf?: (input: any) => SourceRef|null,
 *   appendFollowUp?: (tx: Db, args: { itemId: number, accountId: number|null, input: any }) => Promise<void>,
 *   draft(input: any, ctx: DraftContext): Draft,
 *   persist(tx: Db, draft: any, meta: object): Promise<number>,
 *   loadDetails(db: Db, itemIds: number[]): Promise<Map<number, object>>,
 *   present: { preview(item: any, details: any, ctx: any): object, detail(item: any, details: any, ctx: any): object },
 *   search: { textClause(paramIndex: number): string, rank(paramIndex: number): string, matchLines(details: any, q: string): string[] },
 *   refresh?: (deps: UpkeepDeps, itemId: number, options: { actor: string }) => Promise<{ updated: number, editableUntil: string|null }>,
 *   checkFollowUps?: (deps: UpkeepDeps, itemId: number, options: { actor: string }) => Promise<{ added: number }>,
 * }} Kind
 *
 * `present.preview(card, details, ctx)` / `present.detail(card, details, ctx)`
 * build the `Preview` / `DetailVM` of src/http/contracts.js from a
 * `Card` (src/repo/cards.js), the kind's own `loadDetails` entry and the
 * caller's presenter context. `search.textClause(n)` is a SQL condition
 * on the item aliased `i` matching the bound `ilike` pattern `$n`;
 * `search.rank(n)` a SQL number expression scoring `i` against the bound
 * raw query `$n` (higher first); both interpolate only `n`.
 * `search.matchLines(details, q)` picks the lines a result shows.
 */

const NAME = /^[a-z][a-z0-9_]*$/;
const URL_PREFIX = /^\/[a-z0-9-]+\/$/;

/**
 * Item-page prefixes no kind may take: the engine's own pages and API
 * (`/e/` events, `/p/` people, `/tl/` translators, search, the API, the
 * add flow, the me page). `/t/` belongs to the translation kind alone.
 */
export const RESERVED_URL_PREFIXES = Object.freeze(['/e/', '/p/', '/tl/', '/search/', '/api/', '/add/', '/me/']);
/** @type {Readonly<Record<string, string>>} prefix -> the one kind that owns it */
const OWNED_URL_PREFIXES = Object.freeze({ '/t/': 'translation' });
const REQUIRED_FUNCTIONS = ['matchesUrl', 'fetchSource', 'draft', 'persist', 'loadDetails'];
const REQUIRED_GROUPS = { present: ['preview', 'detail'], search: ['textClause', 'rank', 'matchLines'] };
const OPTIONAL_FUNCTIONS = ['refresh', 'checkFollowUps'];

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
 * @param {any} spec
 * @returns {string[]}
 */
function prefixProblems(spec) {
  const prefix = spec.urlPrefix;
  if (RESERVED_URL_PREFIXES.includes(prefix)) return [`urlPrefix ${prefix} is reserved by the engine`];
  const owner = Object.hasOwn(OWNED_URL_PREFIXES, prefix) ? OWNED_URL_PREFIXES[prefix] : undefined;
  return owner && owner !== spec.name ? [`urlPrefix ${prefix} belongs to the ${owner} kind`] : [];
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
