// @ts-check
/**
 * Step 2 of the add flow and the edit page (Plan 2a Task 13): everything
 * the preview filled in, shown for checking -- placement, event, the
 * hashtags it read, type, client, clip credit, follows-on, and "already
 * subbed". The pinned area reuses the item page's own `mediaBox`, so a
 * clip, pictures, a quote card or nothing all come out exactly as they
 * will on the saved entry.
 *
 * A member picks from the owner-managed lists; only the owner sees "＋
 * new". The page owns the collected values and the re-preview; this file
 * is pure markup.
 */
import { html } from '../core/html.js';
import { on } from '../core/dom.js';
import { t } from '../core/site.js';
import { dayLabel } from '../core/format.js';
import * as mediaBox from './mediaBox.js';
import { NEW } from '../state/addState.js';

/** @typedef {import('../state/addState.js').Choices} Choices */

/** @param {string} name @param {boolean} selected @returns {import('../core/html.js').SafeHtml} */
function option(name, selected) {
  return html`<option value="${name}"${selected ? ' selected' : ''}>${name}</option>`;
}

/** @param {string} value @param {string} label @param {boolean} selected @returns {import('../core/html.js').SafeHtml} */
function labelled(value, label, selected) {
  return html`<option value="${value}"${selected ? ' selected' : ''}>${label}</option>`;
}

/**
 * @param {{ options: any, choices: Choices, eventId: number|null, allowNew: boolean }} props
 *   `allowNew: false` on the edit page: the edit API takes an existing
 *   `eventId` only, so it must not offer an event it could never save.
 * @returns {import('../core/html.js').SafeHtml}
 */
function eventField({ options, choices, eventId, allowNew }) {
  const matched = eventId === null ? null : options.events.find((/** @type {any} */ e) => e.id === eventId);
  const matchName = matched?.name ?? (eventId === null ? null : t('edit.eventById', { id: eventId }));
  const isNew = allowNew && choices.eventMode === 'new';
  return html`
    <div class="c-add-details__field">
      <label class="c-add-details__label" for="c-add-event">${t('add.event')}</label>
      <span class="c-select">
        <select class="c-add-details__select" id="c-add-event" data-field="event">
          ${matchName ? labelled('match', `${matchName} · ${t('add.matches')}`, choices.eventMode === 'match') : ''}
          ${options.events.map((/** @type {any} */ e) => labelled(`event:${e.id}`, e.name, choices.eventMode === `event:${e.id}`))}
          ${allowNew ? labelled('new', t('add.newEvent'), isNew) : ''}
        </select>
      </span>
      ${isNew ? html`
        <label class="c-add-details__label" for="c-add-event-title">${t('add.eventTitle')}</label>
        <input class="c-add-details__input" id="c-add-event-title" data-field="eventName" type="text"
          maxlength="120" autocomplete="off" value="${choices.eventName}">
      ` : ''}
    </div>
  `;
}

/**
 * @param {{ label: string, field: 'category'|'client', values: string[], pick: string, typed: string, isOwner: boolean }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
function lookupField({ label, field, values, pick, typed, isOwner }) {
  const newLabel = field === 'category' ? t('add.newType') : t('add.newClient');
  const newNameLabel = field === 'category' ? t('add.newTypeName') : t('add.newClientName');
  return html`
    <div class="c-add-details__field">
      <label class="c-add-details__label" for="c-add-${field}">${label}</label>
      <span class="c-select">
        <select class="c-add-details__select" id="c-add-${field}" data-field="${field}">
          ${labelled('', t('add.optional'), pick === '')}
          ${values.map((name) => option(name, pick === name))}
          ${isOwner ? labelled(NEW, newLabel, pick === NEW) : ''}
        </select>
      </span>
      ${isOwner && pick === NEW ? html`
        <label class="c-add-details__label" for="c-add-${field}-new">${newNameLabel}</label>
        <input class="c-add-details__input" id="c-add-${field}-new" data-field="${field}New" type="text"
          maxlength="80" autocomplete="off" value="${typed}">
      ` : ''}
    </div>
  `;
}

/**
 * @param {Choices} choices
 * @returns {import('../core/html.js').SafeHtml}
 */
function placementField(choices) {
  return html`
    <div class="c-add-details__field">
      <label class="c-add-details__label" for="c-add-placement">${t('add.placement')}</label>
      <span class="c-select">
        <select class="c-add-details__select" id="c-add-placement" data-field="placement">
          ${['event', 'shared_story', 'post', 'unsorted'].map((p) => labelled(p, t(`add.placement.${p}`), choices.placement === p))}
        </select>
      </span>
    </div>
  `;
}

/** @param {string[]} tags @returns {import('../core/html.js').SafeHtml} */
function hashtagsField(tags) {
  return html`
    <div class="c-add-details__field">
      <p class="c-add-details__label">${t('add.hashtags')}</p>
      <p class="c-add-details__pills">${tags.map((tag) => html`<span class="c-add-details__pill">${tag}</span>`)}</p>
    </div>
  `;
}

/** @param {string} label @param {string} value @returns {import('../core/html.js').SafeHtml} */
function textField(label, value) {
  return html`
    <div class="c-add-details__field">
      <p class="c-add-details__label">${label}</p>
      <p class="c-add-details__value">${value}</p>
    </div>
  `;
}

/** @param {Choices} choices @returns {import('../core/html.js').SafeHtml} */
function subbedCheck(choices) {
  return html`
    <label class="c-add__check">
      <input type="checkbox" data-field="subbed"${choices.subbed ? ' checked' : ''}>
      ${t('add.subbed')}
    </label>
  `;
}

/**
 * @param {{ choices: Choices, showActions: boolean }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
function actionBar({ choices, showActions }) {
  if (!showActions) return html`<div class="c-add__actions"></div>`;
  return html`
    <div class="c-add__actions">
      ${choices.subbed
        ? html`<button class="c-add__save" type="button" data-action="save">${t('add.save')}</button>`
        : html`<button class="c-add__next" type="button" data-action="next">${t('add.nextSpeakers')}</button>`}
    </div>
  `;
}

/**
 * The preview the visitor checks: who wrote it and when, plus the media
 * area when the post has one.
 * @param {{ common: any, tweet: any, media: any }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
function previewBlock({ common, tweet, media }) {
  const who = [
    tweet.authorHandle ? `@${tweet.authorHandle}` : '',
    common.occurredOn ? dayLabel(common.occurredOn) : '',
  ].filter(Boolean).join(' · ');
  return html`
    <div class="c-add-details__preview">
      ${who ? html`<p class="c-add-details__who">${who}</p>` : ''}
      ${media ? mediaBox.render({ media }) : ''}
    </div>
  `;
}

/**
 * Every step-2 field, in the design's order. Split out of `render` so each
 * optional field is its own small choice (the lint complexity budget).
 * @param {{ common: any, tweet: any, newTags: string[], options: any, isOwner: boolean,
 *   choices: Choices, allowNewEvent: boolean }} props
 * @returns {import('../core/html.js').SafeHtml}
 */
function fieldsBlock({ common, tweet, newTags, options, isOwner, choices, allowNewEvent }) {
  const clipBy = tweet.clipSource?.handle ?? tweet.authorHandle ?? null;
  return html`
    <div class="c-add-details__fields">
      ${placementField(choices)}
      ${choices.placement === 'event' ? eventField({ options, choices, eventId: common.eventId ?? null, allowNew: allowNewEvent }) : ''}
      ${newTags.length > 0 ? hashtagsField(newTags) : ''}
      ${lookupField({ label: t('add.type'), field: 'category', values: options.categories, pick: choices.categoryPick, typed: choices.categoryNew, isOwner })}
      ${lookupField({ label: t('add.client'), field: 'client', values: options.clients, pick: choices.clientPick, typed: choices.clientNew, isOwner })}
      ${clipBy ? textField(t('add.clipBy'), `@${clipBy}`) : ''}
      ${common.followsOn ? textField(t('add.followsOn'), t('add.followsOnAdd')) : ''}
      ${subbedCheck(choices)}
    </div>
  `;
}

/**
 * @param {{ draft: any, options: any, isOwner: boolean, choices: Choices,
 *   media?: import('../../../src/http/contracts.js').MediaVM|null, showActions?: boolean,
 *   allowNewEvent?: boolean }} props
 *   `showActions: false` for the edit page, whose one Save bar lives at the
 *   bottom of the page instead of at the end of step 2. `allowNewEvent:
 *   false` likewise: the edit API takes an existing event only.
 * @returns {import('../core/html.js').SafeHtml}
 */
export function render({ draft, options, isOwner, choices, media = null, showActions = true, allowNewEvent = true }) {
  const { common = {}, tweet = {}, newTags = [] } = draft;
  return html`
    <section class="c-add-details">
      <h2 class="c-add__heading">${t('add.detailsTitle')}</h2>
      ${previewBlock({ common, tweet, media })}
      ${fieldsBlock({ common, tweet, newTags, options, isOwner, choices, allowNewEvent })}
      ${actionBar({ choices, showActions })}
    </section>
  `;
}

/**
 * The page's step-2 wiring: every field reports its raw `data-field` name
 * and new value; "next" and "save" (a subbed entry skips step 3) are the
 * page's to act on. The page owns `choices` and the re-preview. The edit
 * page passes neither action (its own Save bar is below both steps); with
 * `showActions: false` they are never rendered anyway.
 * @param {Element} el
 * @param {{ onChange: (field: string, value: string|boolean) => void,
 *   onNext?: () => void, onSave?: () => void }} ctx
 * @returns {void}
 */
export function bind(el, { onChange, onNext, onSave }) {
  on(el, '.c-add-details__select', 'change', (_event, target) => {
    const field = target.getAttribute('data-field');
    if (field) onChange(field, target.value);
  });
  on(el, '.c-add-details__input', 'input', (_event, target) => {
    const field = target.getAttribute('data-field');
    if (field) onChange(field, target.value);
  });
  on(el, '[data-field="subbed"]', 'change', (_event, target) => onChange('subbed', target.checked === true));
  on(el, '[data-action="next"]', 'click', () => onNext?.());
  on(el, '[data-action="save"]', 'click', () => onSave?.());
}
