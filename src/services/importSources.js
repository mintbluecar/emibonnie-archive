// @ts-check
/**
 * Reading the import sources (Plan 3): a Notion CSV export and any block of
 * text holding tweet links. Pure where it can be (the CSV parser and the
 * link extractor); the two DB helpers resolve Artist names and the event
 * a Keyword names.
 */
import { extractTweetIds, parseTweetId, statusUrl } from '../sources/url.js';
import { listPeople } from '../repo/people.js';
import { listVisibleEvents } from '../repo/events.js';

/** @typedef {import('../kinds/defineKind.js').DraftOverrides} DraftOverrides */
/** @typedef {{ url: string, overrides: DraftOverrides, warnings: string[], extra: Record<string, string> }} SourceRow */

/**
 * One quoted cell, starting just after its opening quote. A doubled quote
 * is a literal quote.
 * @param {string} text @param {number} start
 * @returns {[string, number]} the value and the index after the closing quote
 */
function readQuoted(text, start) {
  let value = '';
  let i = start;
  while (i < text.length) {
    if (text[i] === '"' && text[i + 1] === '"') { value += '"'; i += 2; continue; }
    if (text[i] === '"') return [value, i + 1];
    value += text[i];
    i += 1;
  }
  return [value, i];
}

/**
 * RFC-4180-style CSV into rows of cells. Handles quotes, escaped quotes,
 * commas and newlines inside quotes; ignores empty trailing lines.
 * @param {string} text @returns {string[][]}
 */
export function parseCsv(text) {
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let cell = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      const [value, next] = readQuoted(text, i + 1);
      cell += value;
      i = next - 1;
      continue;
    }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ''));
}

/** @param {string} name @returns {string} */
const normaliseHeader = (name) => name.trim().toLowerCase().replace(/[^a-z]+/g, ' ').trim();

const HEADERS = Object.freeze({
  name: 'name', date: 'date', artists: 'artist s', type: 'type', client: 'client media',
  keyword: 'keyword', hashtag: 'hashtag', link: 'translation link', media: 'original media',
});

/**
 * @param {string} value @returns {string|null} YYYY-MM-DD or null
 */
function dateOf(value) {
  const text = String(value ?? '').trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return iso ? iso[1] : null;
}

/**
 * Reads a Notion export. Every row with a valid tweet link becomes a
 * source row; rows without one are skipped with a reason.
 * @param {string} text
 * @returns {{ rows: SourceRow[], skipped: { row: number, reason: string }[] }}
 */
export function parseNotionCsv(text) {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], skipped: [] };
  const index = Object.fromEntries(Object.entries(HEADERS).map(([key, label]) => [key, header.map(normaliseHeader).indexOf(label)]));
  /** @type {SourceRow[]} */
  const rows = [];
  /** @type {{ row: number, reason: string }[]} */
  const skipped = [];
  body.forEach((cells, offset) => {
    const cell = (/** @type {string} */ key) => (index[key] >= 0 ? String(cells[index[key]] ?? '').trim() : '');
    const url = cell('link');
    const id = url ? parseTweetId(url) : null;
    if (!id) { skipped.push({ row: offset + 2, reason: url ? 'not a tweet link' : 'no translation link' }); return; }
    const occurredOn = dateOf(cell('date'));
    /** @type {DraftOverrides} */
    const overrides = {};
    if (occurredOn) overrides.occurredOn = occurredOn;
    if (cell('type')) overrides.categoryName = cell('type');
    if (cell('client')) overrides.clientName = cell('client');
    /** @type {string[]} */
    const warnings = [];
    if (!occurredOn && cell('date')) warnings.push(`unreadable date: ${cell('date')}`);
    rows.push({
      url: statusUrl(id),
      overrides,
      warnings,
      extra: {
        name: cell('name'), artists: cell('artists'), keyword: cell('keyword'),
        hashtag: cell('hashtag'), media: cell('media'),
      },
    });
  });
  return { rows, skipped };
}

/** A bare `x.com/…` or `twitter.com/…` (no scheme, not inside another host or path). */
const BARE_TWEET_HOST = /(?<![\w./:@-])((?:www\.|mobile\.)?(?:x|twitter)\.com\/)/giu;

/**
 * Every tweet id in a block of text, in first-seen order, deduped. Links
 * pasted without a scheme get one, then `extractTweetIds` reads them
 * (so only x.com/twitter.com hosts count).
 * @param {string} text @returns {string[]}
 */
export function extractStatusLinks(text) {
  return extractTweetIds(text.replace(BARE_TWEET_HOST, 'https://$1'));
}

/**
 * Artist names from Notion, matched to known people by display name or IG
 * handle. Unmatched names are warnings, never new people.
 * @param {{ db: import('../db/common.js').Db }} deps
 * @param {string} field a comma-separated list
 * @returns {Promise<{ people: { igHandle: string, role: 'present' }[], warnings: string[] }>}
 */
export async function resolveArtists(deps, field) {
  const names = String(field ?? '').split(',').map((name) => name.trim()).filter((name) => name !== '');
  if (names.length === 0) return { people: [], warnings: [] };
  const people = await listPeople(deps.db);
  /** @type {{ igHandle: string, role: 'present' }[]} */
  const chosen = [];
  const warnings = [];
  for (const name of names) {
    const needle = name.toLowerCase().replace(/^@/, '');
    const person = people.find((candidate) => candidate.displayName.toLowerCase() === needle
      || (candidate.igHandle ?? '').toLowerCase() === needle);
    if (person?.igHandle) chosen.push({ igHandle: person.igHandle, role: 'present' });
    else warnings.push(`unknown artist: ${name}`);
  }
  return { people: chosen, warnings };
}

/**
 * The event a Notion Keyword names, or a request to propose one.
 * @param {{ db: import('../db/common.js').Db }} deps
 * @param {string} keyword
 * @returns {Promise<{ eventId: number } | { newEvent: true, eventName: string } | {}>}
 */
export async function eventOverrideOf(deps, keyword) {
  const text = String(keyword ?? '').trim();
  if (text === '') return {};
  const events = await listVisibleEvents(deps.db, { limit: 500 });
  const needle = text.toLowerCase();
  const match = events.find((event) => event.name.toLowerCase() === needle
    || event.slug.toLowerCase() === needle
    || event.hashtags.some((tag) => tag.toLowerCase() === needle)
    || event.keywords.some((tag) => tag.toLowerCase() === needle));
  return match ? { eventId: match.id } : { newEvent: true, eventName: text };
}
