// @ts-check
/**
 * `translation.remapSpeakers` (Task 10c): the owner's correction of who a
 * marker means on an archived translation. The text is never touched:
 * only `translation_speakers` and `item_people` change, each as a delta
 * (`setSpeakers`, `setItemPeople`), so the audit log shows exactly what
 * moved, under the caller's actor.
 */
import { BadRequest } from '../../domain/errors.js';
import { findMarkers, splitLines } from '../../domain/lines.js';
import { listItemPeople, setItemPeople } from '../../repo/itemPeople.js';
import { loadDetails, setSpeakers } from './repo.js';
import { speakerPeopleOf } from './domain.js';

/** @typedef {import('../defineKind.js').ItemPerson} ItemPerson */
/** @typedef {{ personId: number, role: string }} PersonRow */
/** @typedef {import('../defineKind.js').DraftContext} DraftContext */
/** @typedef {import('../../domain/speakers.js').SpeakerMap} SpeakerMap */

/** @param {{ personId: number, role: string }} p */
const keyOf = (p) => `${p.personId}:${p.role}`;

/**
 * The item's people with what the old speakers contributed swapped for
 * what the new ones do; everyone else (tags, authors, a seed's extra
 * people) stays as stored.
 * @param {PersonRow[]} current @param {PersonRow[]} before @param {PersonRow[]} after
 * @returns {PersonRow[]}
 */
export function swapPeople(current, before, after) {
  const gone = new Set(before.map(keyOf));
  for (const p of after) gone.delete(keyOf(p));
  const kept = current.filter((p) => !gone.has(keyOf(p)));
  const have = new Set(kept.map(keyOf));
  return [...kept, ...after.filter((p) => !have.has(keyOf(p)))];
}

const VS16 = /\uFE0F/gu;

/**
 * The text's own spelling of `marker`: itself when the text uses it,
 * else the one used marker that differs only by U+FE0F (the emoji
 * variation selector a keyboard or terminal may add or drop), else
 * `null`. Several such matches are refused as ambiguous.
 * @param {string} marker @param {string[]} used
 * @returns {string|null}
 */
export function textMarkerFor(marker, used) {
  if (used.includes(marker)) return marker;
  const bare = marker.replace(VS16, '');
  const matches = used.filter((m) => m.replace(VS16, '') === bare);
  if (matches.length > 1) throw new BadRequest(`${marker} matches more than one marker in this item's text, differing only by a variation selector: ${matches.join(' ')}`);
  return matches[0] ?? null;
}

/**
 * The map re-keyed to the text's own markers (`textMarkerFor`), with a
 * note for each one matched only through the variation selector.
 * @param {SpeakerMap} map @param {string[]} used
 * @returns {{ map: SpeakerMap, notes: string[] }}
 */
function onTextMarkers(map, used) {
  /** @type {SpeakerMap} */
  const out = {};
  /** @type {string[]} */
  const notes = [];
  const unknown = [];
  for (const [marker, speaker] of Object.entries(map)) {
    const found = textMarkerFor(marker, used);
    if (found === null) unknown.push(marker);
    else out[found] = speaker;
    if (found !== null && found !== marker) notes.push(`using ${found} (${found.length > marker.length ? 'with' : 'without'} variation selector)`);
  }
  if (unknown.length > 0) throw new BadRequest(`not a marker in this item's text: ${unknown.join(', ')} (it uses: ${used.join(' ') || 'none'})`);
  return { map: out, notes };
}

/**
 * Pending (not yet published) items may be remapped too; hidden or
 * removed ones are refused by the caller (src/services/remap.js).
 * @param {any} tx
 * @param {{ itemId: number, map: SpeakerMap, ctx: DraftContext }} args
 * @returns {Promise<{ speakers: SpeakerMap, people: ItemPerson[], notes: string[] }>}
 */
export async function remapSpeakers(tx, { itemId, map: given, ctx }) {
  const details = (await loadDetails(tx, [itemId])).get(itemId);
  if (!details) throw new BadRequest(`item ${itemId} is not a translation`);
  const used = [...new Set(findMarkers(splitLines(details.body)).map((m) => m.marker))];
  const { map, notes } = onTextMarkers(given, used);
  const { rows } = await tx.query('select placement from items where id = $1', [itemId]);
  const item = { parts: details.parts, placement: rows[0].placement };
  const speakers = { ...details.speakers, ...map };
  const people = swapPeople(await listItemPeople(tx, itemId), speakerPeopleOf(item, details.speakers, ctx), speakerPeopleOf(item, speakers, ctx));
  await setSpeakers(tx, itemId, speakers);
  await setItemPeople(tx, itemId, people);
  return { speakers, people: /** @type {ItemPerson[]} */ (people), notes };
}
