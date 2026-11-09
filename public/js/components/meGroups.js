// @ts-check
/**
 * The me page's lists laid out as home lays out its events (owner,
 * 2026-11-02): a label per month, newest first, and under it the entries
 * grouped by event -- the event's name (linked to its page) and day above
 * a grid of cards. An entry with no event groups by its day, as a shared
 * story or as posts. The API already orders both lists this way
 * (`OWN_LIST_ORDER` in src/repo/items.js), so grouping only folds
 * consecutive runs, as home's months and `pages/hubGroups.js` do.
 *
 * The page renders each entry (`entry`), so this file never knows whether
 * it is "added by me" or "my translations".
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';
import { dayLabel, monthLabel } from '../core/format.js';
import { eventHref } from '../core/routes.js';

/** @typedef {import('../core/html.js').SafeHtml} SafeHtml */
/** @typedef {import('../../../src/http/contracts.js').AddedPreview} Entry */
/**
 * @template {Entry} T
 * @typedef {{ month: string, groups: { key: string, items: T[] }[] }} Month
 */

/** The day an entry is listed under: its event's, else its own. @param {Entry} item @returns {string} */
function dayOf(item) {
  return item.event?.occurredOn ?? item.occurredOn;
}

/** Changes only when the event does, or (no event) the placement or day. @param {Entry} item @returns {string} */
function keyOf(item) {
  if (item.event) return `e:${item.event.slug}`;
  return `${item.placement === 'shared_story' ? 's' : 'p'}:${item.occurredOn}`;
}

/**
 * `items`, in their own order, folded into months and, within a month,
 * consecutive runs of one event (or one day's shared stories or posts).
 * @template {Entry} T
 * @param {T[]} items
 * @returns {Month<T>[]}
 */
export function grouped(items) {
  /** @type {Month<T>[]} */
  const months = [];
  for (const item of items) {
    const month = dayOf(item).slice(0, 7);
    if (months.at(-1)?.month !== month) months.push({ month, groups: [] });
    const { groups } = /** @type {Month<T>} */ (months.at(-1));
    const key = keyOf(item);
    const current = groups.at(-1);
    if (current?.key === key) current.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return months;
}

/** A group's heading: the event (a link to it), else "shared story" or "posts", and the day. @param {Entry} item @returns {SafeHtml} */
function groupHead(item) {
  const name = item.event
    ? html`<a href="${eventHref(item.event.slug)}">${item.event.name}</a>`
    : t(item.placement === 'shared_story' ? 'event.sharedStory' : 'search.posts');
  return html`<h3 class="cluster c-me__group-head"><span class="heading heading--sm">${name}</span> <span class="meta">${dayLabel(dayOf(item))}</span></h3>`;
}

/**
 * @template {Entry} T
 * @param {T[]} items
 * @param {(item: T) => SafeHtml} entry one `<li>` per entry
 * @returns {SafeHtml}
 */
export function render(items, entry) {
  return html`${grouped(items).map((month) => html`
    <section>
      <h2 class="label label--section">${monthLabel(month.month)}</h2>
      <div class="stack">
        ${month.groups.map((group) => html`
          <section class="stack stack--2">
            ${groupHead(group.items[0])}
            <ul class="list grid">${group.items.map(entry)}</ul>
          </section>
        `)}
      </div>
    </section>
  `)}`;
}
