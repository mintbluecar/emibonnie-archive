// @ts-check

/**
 * The item-kind plugin contract. Generic code (ingest, search, hub views)
 * only ever talks to a kind through this shape, and reads only
 * `draft.common` and `draft.missing` from a draft; everything else on a
 * draft is the kind's own business, handed back to its `persist`.
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
 * }} DraftOverrides
 *   What the submitter changed in the add flow. `text` is text typed in by
 *   hand (it replaces the source's text and marks it `textEnteredManually`).
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
 * @typedef {{common: DraftCommon, missing: MissingMarker[], suggestions?: Event[]}} Draft
 *
 * @typedef {any} Db
 * @typedef {{
 *   name: string,
 *   table: string,
 *   urlPrefix: string,
 *   matchesUrl(url: string): string|null,
 *   fetchSource(deps: any, sourceId: string): Promise<unknown>,
 *   followUpOf?: (input: any) => SourceRef|null,
 *   draft(input: any, ctx: DraftContext): Draft,
 *   persist(tx: Db, draft: any, meta: object): Promise<number>,
 *   loadDetails(db: Db, itemIds: number[]): Promise<Map<number, object>>,
 *   present: { preview(item: any, details: any, ctx: any): object, detail(item: any, details: any, ctx: any): object },
 *   search: { textClause(paramIndex: number): string, matchLines(details: any, q: string): string[] },
 * }} Kind
 */

const NAME = /^[a-z][a-z0-9_]*$/;
const URL_PREFIX = /^\/[a-z0-9-]+\/$/;
const REQUIRED_FUNCTIONS = ['matchesUrl', 'fetchSource', 'draft', 'persist', 'loadDetails'];
const REQUIRED_GROUPS = { present: ['preview', 'detail'], search: ['textClause', 'matchLines'] };

/**
 * @param {any} spec
 * @returns {string[]}
 */
function shapeProblems(spec) {
  const problems = [];
  if (typeof spec.name !== 'string' || !NAME.test(spec.name)) problems.push('name must match ^[a-z][a-z0-9_]*$');
  if (typeof spec.table !== 'string' || !NAME.test(spec.table)) problems.push('table must match ^[a-z][a-z0-9_]*$');
  if (typeof spec.urlPrefix !== 'string' || !URL_PREFIX.test(spec.urlPrefix)) problems.push('urlPrefix must look like /x/');
  if (spec.followUpOf !== undefined && typeof spec.followUpOf !== 'function') problems.push('followUpOf must be a function when given');
  return problems;
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

/**
 * A placeholder for a contract method a kind hasn't implemented yet.
 * @param {string} what
 * @returns {() => never}
 */
export function notImplemented(what) {
  return () => {
    throw new Error(`not implemented: ${what}`);
  };
}
