// @ts-check
import { norm } from './text.js';

/**
 * @typedef {import('./constants.js').Role} Role
 * @typedef {import('./lines.js').Marker} Marker
 * @typedef {{person: number}|{role: Role}} Speaker
 * @typedef {Record<string, Speaker>} SpeakerMap
 * @typedef {Record<string, {personHandle: string}|{role: Role}>} DefaultMarkers
 * @typedef {{id: number, igHandle: string}} HandlePerson
 */

/** @param {string} handle */
function handleKey(handle) {
  return norm(handle.replace(/^@/, ''));
}

/**
 * The site's default markers with each `personHandle` resolved to a
 * person id. A handle that names nobody known is skipped, not guessed.
 * @param {DefaultMarkers} defaults
 * @param {HandlePerson[]} people
 * @returns {SpeakerMap}
 */
function resolveDefaults(defaults, people) {
  const idByHandle = new Map(people.map((person) => [handleKey(person.igHandle), person.id]));
  /** @type {SpeakerMap} */
  const map = {};
  for (const [marker, entry] of Object.entries(defaults)) {
    if ('role' in entry) {
      map[marker] = { role: entry.role };
      continue;
    }
    const id = idByHandle.get(handleKey(entry.personHandle));
    if (id !== undefined) map[marker] = { person: id };
  }
  return map;
}

/**
 * The speaker map for one item. Layers, later winning: the site's
 * defaults (handles resolved to ids), then what was remembered for this
 * account, then what the submitter chose. This is the only place these
 * three are merged.
 * @param {{defaults?: DefaultMarkers, people: HandlePerson[], remembered?: SpeakerMap, chosen?: SpeakerMap}} input
 * @returns {SpeakerMap}
 */
export function resolveSpeakers({ defaults = {}, people, remembered = {}, chosen = {} }) {
  return { ...resolveDefaults(defaults, people), ...remembered, ...chosen };
}

/**
 * The used markers that the map says nothing about, in order of use.
 * @param {Marker[]} markers
 * @param {SpeakerMap} map
 * @returns {Marker[]}
 */
export function missingMarkers(markers, map) {
  return markers.filter(({ marker }) => !Object.hasOwn(map, marker));
}

/**
 * The distinct person ids behind the used markers, in order of use.
 * Markers in the map that the text never uses are ignored.
 * @param {SpeakerMap} map
 * @param {Marker[]} markers
 * @returns {number[]}
 */
export function personIdsFrom(map, markers) {
  /** @type {number[]} */
  const ids = [];
  for (const { marker } of markers) {
    const speaker = Object.hasOwn(map, marker) ? map[marker] : undefined;
    if (speaker && 'person' in speaker && !ids.includes(speaker.person)) ids.push(speaker.person);
  }
  return ids;
}
