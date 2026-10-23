// @ts-check
/**
 * Shared logic for the person and translator ("account") pages: folding
 * a hub's paged `DatedSection[]` into event/shared-story/posts groups
 * ("by event") or a flat newest-first list ("all, newest"), the
 * segmented control both pages show to switch between the two (plus
 * person's own "with…" option), and paging each kind section further
 * ("more", review round 1, I1). Every entry still renders through
 * `renderSections`/`KIND_UI` (never a kind-specific component directly),
 * so this file never names a kind -- the same discipline `event.js`
 * already follows for its own sections; it only adds the group *label*
 * (an event's name, "shared story", or "posts") around what `KIND_UI`
 * itself renders, and its own `.c-hub__more` button around a section
 * that `hasMore` (the same "wrap KIND_UI's own render" pattern
 * `event.js`'s `sectionBlock` already uses for its own "more" button).
 * Both views ask each kind for compact entries (`ctx.compact`, Task 9b).
 */
import { html } from '../core/html.js';
import { mount, on } from '../core/dom.js';
import { getJson } from '../core/api.js';
import { t } from '../core/site.js';
import { dayLabel } from '../core/format.js';
import * as chips from '../components/chips.js';
import { KIND_UI, renderSections } from '../kinds/_registry.js';

/** @typedef {import('../../../src/http/contracts.js').DatedSection} DatedSection */
/** @typedef {DatedSection['items'][number]} DatedItem */
/** @typedef {'byEvent'|'all'|'with'} SegKey */
/** @typedef {{ seg: SegKey, seq: number, offset: Record<string, number> }} HubCtx */

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
 * @returns {{ key: string, label: string, kind: string, items: DatedItem[] }[]}
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
  return groups;
}

/** Whether `groups[i]` is the last group of its own kind (so it's the one to carry that kind's real `hasMore`/`total`, and the one its "more" button belongs after). @param {{kind:string}[]} groups @param {number} i @returns {boolean} */
function isLastOfKind(groups, i) {
  return !groups.slice(i + 1).some((g) => g.kind === groups[i].kind);
}

/** @param {DatedSection[]} sections @param {string} kind @returns {DatedSection|undefined} */
const sectionOf = (sections, kind) => sections.find((s) => s.kind === kind);

/** @param {string} kind @returns {import('../core/html.js').SafeHtml} */
function moreButton(kind) {
  return html`<button type="button" class="c-hub__more" data-kind="${kind}">${t('event.more')}</button>`;
}

/**
 * The "by event" segment: each group wrapped in its own labelled
 * section, with its items rendered through `renderSections` (as that
 * group's own one-kind `Section`) -- real `hasMore`/`total` on the
 * trailing group of each kind (review round 1, I1: no more forcing
 * `hasMore: false`), with that kind's own `.c-hub__more` button right
 * after it when there's really more to fetch.
 * @param {DatedSection[]} sections @param {any} ctx
 * @returns {import('../core/html.js').SafeHtml}
 */
export function byEventView(sections, ctx) {
  const groups = groupedByEvent(sections);
  const synthetic = groups.map((g, i) => {
    const real = isLastOfKind(groups, i) ? sectionOf(sections, g.kind) : undefined;
    return { kind: g.kind, total: real?.total ?? g.items.length, hasMore: real?.hasMore ?? false, items: g.items };
  });
  const rendered = renderSections(synthetic, { ...ctx, compact: true });
  return html`${groups.map((group, i) => html`
    <section class="c-hub-group" data-kind="${group.kind}">
      <h2 class="c-hub-group__label">${group.label}</h2>
      ${rendered[i] ?? ''}
    </section>
    ${isLastOfKind(groups, i) && synthetic[i].hasMore ? moreButton(group.kind) : ''}
  `)}`;
}

/** The "all, newest" segment: each kind's section, as-is (already newest first), through `renderSections`, with its own "more" button when `hasMore`. @param {DatedSection[]} sections @param {any} ctx @returns {import('../core/html.js').SafeHtml} */
export function flatView(sections, ctx) {
  const rendered = renderSections(sections, { ...ctx, compact: true });
  return html`${sections.map((section, i) => html`${rendered[i] ?? ''}${section.hasMore ? moreButton(section.kind) : ''}`)}`;
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

/**
 * `sections` with `kind`'s items extended by `page`'s own page of that
 * kind, and its `hasMore`/`total` refreshed from the response (review
 * round 1, I1). Pure: returns a new array; a section of any other kind
 * passes through unchanged.
 * @param {DatedSection[]} sections @param {string} kind @param {{ sections: DatedSection[] }} page
 * @returns {DatedSection[]}
 */
export function mergedWithMore(sections, kind, page) {
  const incoming = sectionOf(page.sections, kind);
  if (!incoming) return sections;
  return sections.map((s) => (s.kind === kind ? { ...s, items: [...s.items, ...incoming.items], hasMore: incoming.hasMore, total: incoming.total } : s));
}

/** @typedef {{ root: Element, apiPath: string, data: { sections: DatedSection[] }, ctx: HubCtx }} MoreOpts */

/** Applies a freshly fetched `kind` page: merges it in, updates the kind's own offset, and re-renders `.c-hub__content` for whichever segment is active. @param {MoreOpts} opts @param {string} kind @param {{ sections: DatedSection[] }} page @returns {void} */
function applyMorePage(opts, kind, page) {
  opts.data.sections = mergedWithMore(opts.data.sections, kind, page);
  opts.ctx.offset[kind] = sectionOf(opts.data.sections, kind)?.items.length ?? opts.ctx.offset[kind];
  const contentEl = opts.root.querySelector('.c-hub__content');
  if (!contentEl) return;
  mount(contentEl, activeView(opts.ctx.seg, opts.data.sections, {}));
  bindSections(contentEl, opts.data.sections);
}

/**
 * Fetches `kind`'s next page (an offset per kind, since each kind pages
 * separately), guarded by `opts.ctx.seq` against a response landing
 * after a newer "more" click, segment switch, or (person page) picker
 * fetch -- the same shared sequence number every async action on the
 * page bumps and checks, review-pattern shared with `components/inlineSearch.js`'s own
 * refetch/loadMore.
 * @param {MoreOpts} opts @param {HTMLButtonElement} button
 * @returns {Promise<void>}
 */
async function loadMore(opts, button) {
  const kind = button.getAttribute('data-kind');
  const section = kind ? sectionOf(opts.data.sections, kind) : undefined;
  if (!kind || !section) return;
  const mySeq = ++opts.ctx.seq;
  button.disabled = true;
  try {
    const page = await getJson(opts.apiPath, { offset: opts.ctx.offset[kind] ?? section.items.length });
    if (mySeq !== opts.ctx.seq) return;
    applyMorePage(opts, kind, page);
  } catch {
    if (mySeq !== opts.ctx.seq) return;
    button.disabled = false;
  }
}

/**
 * Wires every `.c-hub__more` button inside `root` once, delegated (so a
 * re-render of `.c-hub__content` never stacks a duplicate listener --
 * the same discipline `components/inlineSearch.js`'s own `.c-search__more` already
 * follows, and the exact bug review round 1, I2 found in this page's
 * own "with…" picker).
 * @param {Element} root @param {string} apiPath @param {{ sections: DatedSection[] }} data @param {HubCtx} ctx
 * @returns {void}
 */
export function bindMore(root, apiPath, data, ctx) {
  const opts = { root, apiPath, data, ctx };
  on(root, '.c-hub__more', 'click', (_e, button) => { loadMore(opts, button); });
}
