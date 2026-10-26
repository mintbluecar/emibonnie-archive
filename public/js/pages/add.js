// @ts-check
/**
 * The add page, as far as Plan 2a Task 12 reaches: signed out, it is the
 * sign-in screen with `/add` as the return path; signed in, a placeholder
 * that Task 13 replaces with the real form. It exists now because the
 * build needs one `public/js/pages/<page>.js` per `{{asset:js:add}}`
 * token (and the tab bar already links here), and so a signed-out visitor
 * who taps "＋ add" signs in and comes straight back.
 */
import { html } from '../core/html.js';
import { mountPage } from '../core/dom.js';
import { getMe } from '../core/session.js';
import { site, t } from '../core/site.js';
import * as pageShell from '../components/pageShell.js';
import * as signIn from '../components/signIn.js';
import { ADD_PATH } from '../core/routes.js';
import { mountLoadError } from './pageError.js';

const APP_SELECTOR = 'app';

/** @returns {import('../core/html.js').SafeHtml} */
function composeSignedOut() {
  return pageShell.render({
    active: 'add',
    compact: true,
    content: html`
      <h1 class="c-me__title">${t('add.title')}</h1>
      ${signIn.render({ returnTo: ADD_PATH })}
    `,
  });
}

/** @returns {import('../core/html.js').SafeHtml} */
function composeSignedIn() {
  return pageShell.render({
    active: 'add',
    compact: true,
    content: html`
      <h1 class="c-me__title">${t('add.title')}</h1>
      <p class="c-me__empty">${t('add.placeholder')}</p>
    `,
  });
}

/** @returns {Promise<void>} */
export async function start() {
  const root = document.getElementById(APP_SELECTOR);
  if (!root) return;
  document.title = site.name;
  let me;
  try {
    me = await getMe();
  } catch {
    mountLoadError(root, { active: 'add' });
    return;
  }
  document.title = `${t('add.title')} · ${site.name}`;
  mountPage(root, me.user ? composeSignedIn() : composeSignedOut());
}

if (typeof document !== 'undefined') start();
