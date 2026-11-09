// @ts-check
/**
 * Date label helpers shared by every page. `monthLabel`/`dayLabel`
 * read the `YYYY-MM[-DD]` string directly (never parsed as a local-time
 * `Date`), so a label never shifts a day depending on the viewer's zone.
 * There is no clock-time helper (owner's rule, Task 10b): a time is shown
 * only where the event happened, in that place's local time, and the
 * engine doesn't store that yet -- so pages show dates only, never the
 * viewer's device-local time.
 */

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `'2026-10'` → `'October 2026'`. @param {string} yearMonth @returns {string} */
export function monthLabel(yearMonth) {
  const [year, month] = yearMonth.split('-');
  return `${MONTHS_LONG[Number(month) - 1]} ${year}`;
}

/** `'2026-10-14'` → `'14 Oct 2026'` (no leading zero on the day). @param {string} isoDate @returns {string} */
export function dayLabel(isoDate) {
  const [year, month, day] = isoDate.split('-');
  return `${Number(day)} ${MONTHS_SHORT[Number(month) - 1]} ${year}`;
}
