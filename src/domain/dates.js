// @ts-check

/**
 * Formats an instant as a `YYYY-MM-DD` calendar date in a given IANA time
 * zone, using `Intl.DateTimeFormat` (no date library). `en-CA` is the
 * locale that happens to format dates as `YYYY-MM-DD`.
 * @param {string} instantIso
 * @param {string} timezone
 * @returns {string}
 */
export function localDate(instantIso, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(instantIso));
}

/**
 * The calendar year of an instant in a given time zone. Always derived
 * from the `instantIso` it is given, never from the system clock: callers
 * that lack a `postedAt` must not call this (see `header.js`, which leaves
 * a bare `d/m` live date as `null` rather than reading the clock).
 * @param {string} instantIso
 * @param {string} timezone
 * @returns {number}
 */
export function localYear(instantIso, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric' });
  return Number(formatter.format(new Date(instantIso)));
}

/**
 * The number of calendar days from `a` to `b`, both `YYYY-MM-DD` strings.
 * Negative when `b` is before `a`. Pure date-only arithmetic: no `Date`
 * instance is ever constructed, so there is no time-zone or DST drift.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function daysBetween(a, b) {
  return (utcDayNumber(b) - utcDayNumber(a)) / 86_400_000;
}

/** @param {string} dateStr */
function utcDayNumber(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}
