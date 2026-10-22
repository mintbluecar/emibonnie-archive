// @ts-check
/**
 * Shared pure helpers for the person and translator ("account") pages:
 * folding a hub's paged `DatedSection[]` into event/shared-story/posts
 * groups ("by event") or a flat newest-first list ("all, newest"), and
 * the segmented control both pages show to switch between the two (plus
 * person's own "with…" option). Every entry still renders through
 * `renderSections`/`KIND_UI` (never a kind-specific component directly),
 * so this file never names a kind -- the same discipline `event.js`
 * already follows for its own sections; it only adds the group *label*
 * (an event's name, "shared story", or "posts") around what `KIND_UI`
 * itself renders.
 */
import { html } from '../core/html.js';
import { t } from '../core/site.js';
import { dayLabel } from '../core/format.js';
import * as chips from '../components/chips.js';
import { KIND_UI, renderSections } from '../kinds/_registry.js';

/** @typedef {import('../../../src/http/contracts.js').DatedSection} DatedSection */
/** @typedef {DatedSection['items'][number]} DatedItem */
/** @typedef {'byEvent'|'all'|'with'} SegKey */

/**
 * A group key that changes only when the kind, the event, or (for an
 * item with no event) the placement/date does -- so a group's items
 * always share one kind, safe to re-wrap as that kind's own `Section`.
 * @param {DatedItem} item @returns {string}
 */
function groupKeyOf(item) {
  if (item.event) return `${item.kind}:e:${item.event.slug}`;
  if (item.placement === 'shared_story') return `${item.kind}:s:${item.occurredOn}`;
  // A standalone post/unsorted item has no event-like identity of its own
  // to group by, so every one of a kind folds into one "posts" bucket
  // (still a fresh bucket if it's not contiguous with an earlier one --
  // e.g. an event in between -- same as any other group boundary).
  return `${item.kind}:p`;
}

/** The label shown above a group: the event (plus its day), "shared story" (plus its day), or the generic "posts" label otherwise. @param {DatedItem} item @returns {string} */
function groupLabelOf(item) {
  if (item.event) return `${item.event.name} · ${dayLabel(item.occurredOn)}`;
  if (item.placement === 'shared_story') return `${t('event.sharedStory')} · ${dayLabel(item.occurredOn)}`;
  return t('search.posts');
}

/**
 * Every item across `sections` (already in kind-registry order, each
 * kind already paged/ordered by the API), folded into consecutive
 * groups -- the same "key changed since the last entry" pattern
 * `home.js`'s month grouping uses, just over a richer key.
 * @param {DatedSection[]} sections
 * @returns {{ label: string, kind: string, items: DatedItem[] }[]}
 */
export function groupedByEvent(sections) {
  /** @type {{ key: string, label: string, kind: string, items: DatedItem[] }[]} */
  const groups = [];
  for (const section of sections) {
    for (const item of section.items) {
      const key = groupKeyOf(item);
      const current = groups.at(-1);
      if (current?.key !== key) groups.push({ key, label: groupLabelOf(item), kind: item.kind, items: [item] });
      else current.items.push(item);
    }
  }
  return groups.map(({ label, kind, items }) => ({ label, kind, items }));
}

/**
 * The "by event" segment: each group wrapped in its own labelled
 * section, with its items rendered through `renderSections` (as that
 * group's own one-kind, one-page `Section`).
 * @param {DatedSection[]} sections @param {any} ctx
 * @returns {import('../core/html.js').SafeHtml}
 */
export function byEventView(sections, ctx) {
  const groups = groupedByEvent(sections);
  const rendered = renderSections(groups.map((g) => ({ kind: g.kind, total: g.items.length, hasMore: false, items: g.items })), ctx);
  return html`${groups.map((group, i) => html`
    <section class="c-hub-group">
      <h2 class="c-hub-group__label">${group.label}</h2>
      ${rendered[i] ?? ''}
    </section>
  `)}`;
}

/** The "all, newest" segment: each kind's section, as-is (already newest first), through `renderSections` -- no extra grouping. @param {DatedSection[]} sections @param {any} ctx @returns {import('../core/html.js').SafeHtml} */
export function flatView(sections, ctx) {
  return html`${renderSections(sections, ctx)}`;
}

/** Renders `sections` for the currently active segment (`'with'` has no view of its own: it only opens the picker). @param {SegKey} active @param {DatedSection[]} sections @param {any} ctx @returns {import('../core/html.js').SafeHtml} */
export function activeView(active, sections, ctx) {
  return active === 'all' ? flatView(sections, ctx) : byEventView(sections, ctx);
}

/** Binds every kind actually present, over the real sections (both segments show a subset of the same kinds). @param {Element} root @param {DatedSection[]} sections @returns {void} */
export function bindSections(root, sections) {
  for (const section of sections) KIND_UI[section.kind]?.section.bind?.(root);
}

/**
 * @param {SegKey} active @param {boolean} withPicker whether to show the third, person-only "with…" option
 * @returns {import('../core/html.js').SafeHtml}
 */
export function segmentedControl(active, withPicker) {
  const items = [
    { label: t('person.byEvent'), value: 'byEvent', active: active === 'byEvent' },
    { label: t('person.allNewest'), value: 'all', active: active === 'all' },
    ...(withPicker ? [{ label: t('person.with'), value: 'with' }] : []),
  ];
  return html`<div class="c-hub__seg">${chips.render({ items })}</div>`;
}
