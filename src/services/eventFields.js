// @ts-check
/**
 * The checks every event admin write makes (`eventAdmin.js`,
 * `eventMoves.js`): the shape of an event's fields and of id lists, run
 * before writing; and, inside the write's transaction, the state of the
 * events involved (row-locked, so a stale tab can't act on an event
 * another tab just merged away) and the event's address.
 */
import { BadRequest, Conflict, NotFound } from '../domain/errors.js';
import { addressOf, defaultAddressTag, withClashSuffix } from '../domain/eventAddress.js';
import { listPlatforms, lockEvents, takenSlugs } from '../repo/eventAdmin.js';

/** @typedef {import('../db/common.js').Queryable} Tx */

/**
 * What the event page saves. `addressTag` blank means the default
 * (`defaultAddressTag`: the first hashtag, else the name).
 * @typedef {{ name: string, occurredOn: string, keywords: string[], hashtags: string[],
 *   livePeopleIds: number[], livePlatformCode: string|null, addressTag: string }} EventFields
 */

/** @typedef {{ id: number, slug: string, mergedInto: number|null, addressLocked: boolean }} EventState */

const NAME_MAX = 120;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date written `YYYY-MM-DD`. @param {unknown} value @returns {value is string} */
function isDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** @param {unknown} value @param {string} field @returns {string[]} the strings, trimmed, blanks dropped */
function stringList(value, field) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new BadRequest(`${field} must be a list of text`);
  return value.map((entry) => entry.trim()).filter((entry) => entry !== '');
}

/** @param {unknown} value @returns {value is number} */
function isId(value) {
  return Number.isSafeInteger(value) && /** @type {number} */ (value) > 0;
}

/**
 * `ids` as a list of distinct positive integers, at least one.
 * @param {unknown} ids @param {string} field @returns {number[]}
 */
export function checkIds(ids, field) {
  if (!Array.isArray(ids) || ids.length === 0) throw new BadRequest(`${field} must list at least one id`);
  if (!ids.every(isId)) throw new BadRequest(`${field} must be ids`);
  if (new Set(ids).size !== ids.length) throw new BadRequest(`${field} lists an id twice`);
  return ids;
}

/** @param {unknown} value @returns {string} the trimmed name, or `BadRequest` */
function checkName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name === '' || name.length > NAME_MAX) throw new BadRequest(`name must be 1-${NAME_MAX} characters`);
  return name;
}

/** @param {unknown} value @returns {number[]} the ids, each once, or `BadRequest` */
function checkPeople(value) {
  if (!Array.isArray(value) || !value.every(isId)) throw new BadRequest('livePeopleIds must be ids');
  return [...new Set(value)];
}

/** @param {Tx} db @param {string|null|undefined} code @returns {Promise<string|null>} a `platforms` code or null, or `BadRequest` */
async function checkPlatform(db, code) {
  if (code === null || code === undefined) return null;
  if (!(await listPlatforms(db)).includes(code)) throw new BadRequest('unknown live platform');
  return code;
}

/**
 * The fields with the name trimmed, blank tags dropped and the address
 * tag defaulted; `BadRequest` for anything that can't be saved. The live
 * platform is checked against the database (`platforms`).
 * @param {Tx} db @param {EventFields} fields @returns {Promise<EventFields>}
 */
export async function checkFields(db, fields) {
  const name = checkName(fields?.name);
  if (!isDate(fields.occurredOn)) throw new BadRequest('occurredOn must be a date (YYYY-MM-DD)');
  const keywords = stringList(fields.keywords, 'keywords');
  const hashtags = stringList(fields.hashtags, 'hashtags');
  const livePeopleIds = checkPeople(fields.livePeopleIds);
  const livePlatformCode = await checkPlatform(db, fields.livePlatformCode);
  const tag = typeof fields.addressTag === 'string' ? fields.addressTag.trim() : '';
  const addressTag = tag === '' ? defaultAddressTag({ hashtags, name }) : tag;
  return { name, occurredOn: fields.occurredOn, keywords, hashtags, livePeopleIds, livePlatformCode, addressTag };
}

/**
 * Locks and answers the events `ids` name, refusing an unknown one
 * (`BadRequest('unknown event')`, or `NotFound` when it is `pathId`, the
 * route's own `:id`: Ruling R2) or a merged-away one
 * (`Conflict('merged')`). A report-hidden event is fine.
 * @param {Tx} tx @param {number[]} ids @param {number|null} [pathId]
 * @returns {Promise<Map<number, EventState>>}
 */
export async function liveEvents(tx, ids, pathId = null) {
  const events = await lockEvents(tx, ids);
  for (const id of ids) {
    const event = events.get(id);
    if (!event) throw id === pathId ? new NotFound() : new BadRequest('unknown event');
    if (event.mergedInto !== null) throw new Conflict('merged');
  }
  return events;
}

/**
 * The address an event with these fields takes: a locked event keeps
 * its slug; otherwise `date/tag`, numbered past every other event's slug
 * (its own excluded, so re-saving it doesn't clash with itself). `event`
 * is `null` for a new one.
 * @param {Tx} tx @param {EventState|null} event @param {EventFields} fields @returns {Promise<string>}
 */
export async function addressFor(tx, event, fields) {
  if (event?.addressLocked) return event.slug;
  const address = addressOf(fields);
  const taken = await takenSlugs(tx, address);
  if (event) taken.delete(event.slug);
  return withClashSuffix(address, taken);
}
