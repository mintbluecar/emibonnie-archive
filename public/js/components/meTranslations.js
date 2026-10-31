// @ts-check
/**
 * The translator's own section of the me page (Plan 2b): the one-time
 * welcome, "my translations" with multi-select remove, removed rows with
 * restore, and the opt-out box. The page owns fetching and state; this
 * component owns the markup and the actions, and calls back to reload.
 *
 * Copy rule: translators see "remove", never "hide"; only the two actions
 * that need words are text (the remove bar and the opt-out button), and
 * every other control is a normal button with its own visible text.
 */
import { html } from '../core/html.js';
import { on } from '../core/dom.js';
import { postJson } from '../core/api.js';
import { t, tCount } from '../core/site.js';
import * as previewCard from './previewCard.js';

/** @typedef {import('../../../src/http/contracts.js').TranslatorPreview} TranslatorPreview */

/** @param {{ kind: string, sourceId: string }} item @returns {string} */
export function keyOf(item) {
  return `${item.kind}:${item.sourceId}`;
}

/**
 * @typedef {{
 *   handle: string|null,
 *   items: TranslatorPreview[],
 *   hasMore: boolean,
 *   totals: { translations: number, events: number, sharedStories: number },
 *   selected: Set<string>,
 *   optedOut: boolean,
 *   welcome: boolean,
 *   error: string,
 * }} TranslationsState
 */

/**
 * The row's state as a badge (removed and hidden plain, held the accent,
 * refused the danger), or an empty span for a live row.
 * @param {TranslatorPreview} item @returns {import('../core/html.js').SafeHtml}
 */
function stateBadgeOf(item) {
  if (item.removedByYou) return html`<span class="badge">${t('me.translations.removedByYou')}</span>`;
  if (item.hidden) return html`<span class="badge">${t('me.translations.hidden')}</span>`;
  if (item.reviewState === 'pending') return html`<span class="badge badge--accent">${t('me.pending')}</span>`;
  if (item.reviewState === 'rejected') return html`<span class="badge badge--danger">${t('me.rejected')}</span>`;
  return html`<span></span>`;
}

/** @param {TranslationsState} state @returns {import('../core/html.js').SafeHtml} */
function welcomeBlock(state) {
  const { handle, totals } = state;
  return html`
    <div class="card c-me__welcome">
      <p class="heading heading--md c-me__welcome-hi">${t('me.welcome.hi', { handle: handle ?? '' })}</p>
      <p class="badge badge--accent">${t('me.welcome.badge')}</p>
      <p class="meta c-me__welcome-totals">${t('me.welcome.totals', {
        translations: totals.translations, events: totals.events, sharedStories: totals.sharedStories,
      })}</p>
      <div class="cluster cluster--2 c-me__welcome-actions">
        <button class="btn btn--secondary c-me__welcome-see" type="button" data-action="welcome-see">${t('me.welcome.see')}</button>
        <a class="btn btn--secondary" href="/add">${t('me.welcome.add')}</a>
      </div>
    </div>
  `;
}

/**
 * @param {TranslatorPreview} item
 * @param {TranslationsState} state
 * @returns {import('../core/html.js').SafeHtml}
 */
function row(item, state) {
  const key = keyOf(item);
  const selectable = !item.removedByYou && !item.hidden && item.reviewState !== 'rejected';
  return html`
    <li class="c-me__entry"${item.removedByYou || item.hidden ? html` data-faded` : ''}>
      <div class="c-me__entry-top">
        ${selectable ? html`
          <label class="check c-me__select">
            <input type="checkbox" data-action="select" data-key="${key}"
              aria-label="${t('me.translations.select')}" ${state.selected.has(key) ? 'checked' : ''}>
          </label>
        ` : ''}
        ${previewCard.render({ result: item, compact: true })}
      </div>
      <div class="c-me__bar">
        ${stateBadgeOf(item)}
        ${item.removedByYou ? html`
          <button class="btn btn--quiet btn--sm" type="button" data-action="restore" data-kind="${item.kind}"
            data-source="${item.sourceId}">${t('me.translations.restore')}</button>
        ` : ''}
      </div>
    </li>
  `;
}

/** @param {TranslationsState} state @returns {import('../core/html.js').SafeHtml} */
function removeBar(state) {
  const count = state.selected.size;
  return html`
    <div class="c-me__bar">
      <span class="meta" data-count>${t('me.translations.selected', { count })}</span>
      <button class="btn btn--danger btn--sm" type="button" data-action="remove" ${count === 0 ? 'disabled' : ''}>
        ${t('me.translations.remove')}
      </button>
    </div>
  `;
}

/** @param {TranslationsState} state @returns {import('../core/html.js').SafeHtml} */
function optOutBox(state) {
  if (state.optedOut) {
    return html`
      <section class="card card--compact stack stack--2 c-me__optout">
        <p class="c-me__optout-done">${t('me.optOut.done')}</p>
        <button class="btn btn--danger btn--block" type="button" data-action="opt-in">${t('me.optOut.back')}</button>
      </section>
    `;
  }
  return html`
    <section class="stack stack--2 c-me__optout c-me__optout--solid">
      <h3 class="c-me__optout-title">${t('me.optOut.title')}</h3>
      <p class="c-me__optout-body">${tCount('me.optOut.body', state.totals.translations)}</p>
      <button class="btn btn--danger btn--block" type="button" data-action="opt-out">${t('me.optOut.confirm')}</button>
    </section>
  `;
}

/** @param {TranslationsState} state @returns {import('../core/html.js').SafeHtml} */
export function render(state) {
  const list = state.items.length > 0
    ? html`<ul class="c-me__list">${state.items.map((item) => row(item, state))}</ul>`
    : html`<p class="meta c-me__empty">${t('me.translations.empty')}</p>`;
  return html`
    <section data-translations>
      ${state.welcome ? welcomeBlock(state) : ''}
      ${state.items.length > 0 ? removeBar(state) : ''}
      ${list}
      ${state.hasMore ? html`<button class="btn btn--secondary btn--block c-me__more" type="button" data-action="more-translations">${t('me.translations.more')}</button>` : ''}
      ${optOutBox(state)}
      <p class="notice notice--error c-me__status" role="status" data-status>${state.error}</p>
    </section>
  `;
}

/**
 * @param {Element} root
 * @param {{ state: TranslationsState, reload: () => Promise<void> }} handlers
 * @returns {void}
 */
export function bind(root, { state, reload }) {
  previewCard.bind(root);

  const showFailure = () => {
    state.error = t('me.translations.failed');
    const status = root.querySelector('[data-status]');
    if (status) status.textContent = state.error;
  };
  /** @param {() => Promise<unknown>} action */
  const act = async (action) => {
    try {
      await action();
      await reload();
    } catch {
      showFailure();
    }
  };

  on(root, '[data-action="select"]', 'change', (_event, input) => {
    const key = input.getAttribute('data-key') ?? '';
    if (/** @type {HTMLInputElement} */ (input).checked) state.selected.add(key);
    else state.selected.delete(key);
    const count = root.querySelector('[data-count]');
    if (count) count.textContent = t('me.translations.selected', { count: state.selected.size });
    const remove = /** @type {HTMLButtonElement|null} */ (root.querySelector('[data-action="remove"]'));
    if (remove) remove.disabled = state.selected.size === 0;
  });

  on(root, '[data-action="remove"]', 'click', async () => {
    if (state.selected.size === 0) return;
    const items = [...state.selected].map((key) => {
      const [kind, ...rest] = key.split(':');
      return { kind, sourceId: rest.join(':') };
    });
    await act(async () => {
      await postJson('/api/me/translations/remove', { items });
      state.selected.clear();
    });
  });

  on(root, '[data-action="restore"]', 'click', async (_event, button) => {
    const items = [{ kind: button.getAttribute('data-kind'), sourceId: button.getAttribute('data-source') }];
    await act(() => postJson('/api/me/translations/restore', { items }));
  });

  on(root, '[data-action="opt-out"]', 'click', () => act(() => postJson('/api/me/translations/opt-out')));
  on(root, '[data-action="opt-in"]', 'click', () => act(() => postJson('/api/me/translations/opt-in')));
  on(root, '[data-action="welcome-see"]', 'click', () => act(() => postJson('/api/me/welcomed')));
}
