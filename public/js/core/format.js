// @ts-check
/**
 * Date/time label helpers shared by every page. `monthLabel`/`dayLabel`
 * read the `YYYY-MM[-DD]` string directly (never parsed as a local-time
 * `Date`), so a label never shifts a day depending on the viewer's zone.
 */

const MONTHS_LONG = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `'2026-10'` → `'october 2026'`. @param {string} yearMonth @returns {string} */
export function monthLabel(yearMonth) {
  const [year, month] = yearMonth.split('-');
  return `${MONTHS_LONG[Number(month) - 1]} ${year}`;
}

/** `'2026-10-14'` → `'14 Oct 2026'` (no leading zero on the day). @param {string} isoDate @returns {string} */
export function dayLabel(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${Number(day)} ${MONTHS_SHORT[Number(month) - 1]} ${year}`;
}

/**
 * The last segment of a time-zone name, lowercased, `_` → space.
 * `'Asia/Bangkok'` → `'bangkok'`; `'America/Los_Angeles'` → `'los angeles'`.
 * @param {string} tz
 * @returns {string}
 */
export function cityOf(tz) {
  const parts = tz.split('/');
  return parts[parts.length - 1].toLowerCase().replace(/_/g, ' ');
}

/**
 * `'4:00 pm'`: hour with no leading zero, lowercase am/pm. Some ICU
 * builds use a narrow no-break space before am/pm; normalised to a plain
 * space either way.
 * @param {string} iso
 * @param {string} tz
 * @returns {string}
 */
function clockTime(iso, tz) {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
  return formatted.replace(/[\u202f\u2009]/g, ' ').toLowerCase();
}

/**
 * `'4:00 pm paris · 10:00 pm bangkok'` (the viewer's zone first, then the
 * site's), or a single value when the viewer and the site share a zone.
 * @param {string} iso
 * @param {string} siteTz
 * @param {string} [viewerTz]
 * @returns {string}
 */
export function timePair(iso, siteTz, viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const viewerLabel = `${clockTime(iso, viewerTz)} ${cityOf(viewerTz)}`;
  if (viewerTz === siteTz) return viewerLabel;
  return `${viewerLabel} · ${clockTime(iso, siteTz)} ${cityOf(siteTz)}`;
}
