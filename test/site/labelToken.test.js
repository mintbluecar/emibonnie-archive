// @ts-check
/**
 * Task 9a item 9: accent *text* (section and month headings, the active
 * tab, result-card event names, open-profile and contact links) uses its
 * own `--color-label` token, so a site can keep its exact brand gradient
 * and still pick a readable label colour. Gradients and backgrounds keep
 * `--gradient-from`/`--gradient-to`.
 */
import '../helpers/siteFixture.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STYLES = fileURLToPath(new URL('../../src/styles/', import.meta.url));
// Dynamic imports: see test/components/header.test.js for why.
const { MiniElement } = await import('../helpers/miniDom.js');
const { mount } = await import('../../public/js/core/dom.js');
const { composeHome } = await import('../../public/js/pages/home.js');
const { composePerson } = await import('../../public/js/pages/person.js');
const resultCard = await import('../../public/js/components/resultCard.js');
const HOME = JSON.parse(readFileSync(new URL('../snapshots/home.json', import.meta.url), 'utf8'));
const PERSON = JSON.parse(readFileSync(new URL('../snapshots/person.json', import.meta.url), 'utf8'));

/**
 * Mounts `markup` into a mini DOM and returns the class list of every
 * element `selector` matches, so a test asserts on what renders, not on
 * the template's source text.
 * @param {unknown} markup @param {string} selector @returns {string[][]}
 */
function classesOf(markup, selector) {
  const root = new MiniElement('div');
  mount(root, /** @type {any} */ (markup));
  return root.querySelectorAll(selector).map((/** @type {any} */ el) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
}

/** Every match has `cls`, and there is at least one. @param {string[][]} lists @param {string} cls @param {string} what */
function allHave(lists, cls, what) {
  assert.ok(lists.length > 0, `${what}: rendered`);
  for (const list of lists) assert.ok(list.includes(cls), `${what}: has ${cls} (got ${list.join(' ')})`);
}

/** @param {string} dir @returns {string[]} */
const cssFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
  e.isDirectory() ? cssFiles(path.join(dir, e.name)) : e.name.endsWith('.css') ? [path.join(dir, e.name)] : []
));

test('no engine text colour uses a gradient token: they go through --color-label', () => {
  const offenders = cssFiles(STYLES).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/(?:^|[;{\s])color:\s*([^;}]*)/g)]
    .filter((m) => /--gradient-(?:from|to)/.test(m[1])).map((m) => `${path.basename(file)}: color: ${m[1].trim()}`));
  assert.deepEqual(offenders, []);
});

test('--color-label is defined for light and dark mode, defaulting to --gradient-to, and used for every accent label', () => {
  const tokens = readFileSync(path.join(STYLES, 'tokens.css'), 'utf8');
  const [light, dark] = tokens.split('@media (prefers-color-scheme: dark)');
  assert.match(light, /--color-label:\s*var\(--gradient-to\);/);
  assert.match(dark, /--color-label:\s*var\(--gradient-to\);/);
  const uses = cssFiles(path.join(STYLES, 'components')).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/([^{}]+)\{[^}]*color:\s*var\(--color-label\)/g)]
    .flatMap((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim())));
  for (const selector of ['.c-tabbar__item[aria-current="page"]', '.c-account__open-profile', '.c-static__contact a']) {
    assert.ok(uses.includes(selector), `${selector} uses --color-label (got ${uses.join(', ')})`);
  }
  // Styling system Task 12: the month and group headings and the result
  // card's event line are the label primitive, which uses --color-label.
  assert.match(readFileSync(path.join(STYLES, 'primitives/text.css'), 'utf8'), /\.label\s*\{[^}]*color:\s*var\(--color-label\)/);
  allHave(classesOf(composeHome(HOME), 'h2'), 'label', 'home month headings');
  allHave(classesOf(composePerson(PERSON), '[data-hub-group] h2'), 'label', 'person page group headings');
  const result = {
    kind: 'translation', sourceId: '1', url: '/t/1', lines: [], people: [], accountHandle: null, accountUrl: null, hasVideo: false, thumb: null,
    followsOnFrom: null, occurredOn: '2026-10-14', placement: 'post', event: { slug: 'e', name: 'An event' }, matchLines: ['a line'],
  };
  allHave(classesOf(resultCard.render({ result: /** @type {any} */ (result), q: '' }), '.c-result-card__event'), 'label', 'result card event line');
});

/** @param {string} css @param {string} name @returns {string|undefined} */
const tokenIn = (css, name) => new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1].trim();

test('Task 9b: a pale --color-highlight is defined for light and dark mode, and ink text on it passes AA in both', async () => {
  const { contrastRatio } = await import('../../src/site/contrast.js');
  const tokens = readFileSync(path.join(STYLES, 'tokens.css'), 'utf8');
  const [light, dark] = tokens.split('@media (prefers-color-scheme: dark)');
  for (const [mode, css] of [['light', light], ['dark', dark]]) {
    const highlight = tokenIn(css, '--color-highlight');
    const ink = tokenIn(css, '--color-ink');
    assert.ok(highlight && ink, `${mode}: --color-highlight and --color-ink are plain colours`);
    assert.ok(contrastRatio(highlight, ink) >= 4.5, `${mode}: ink on ${highlight} is ${contrastRatio(highlight, ink).toFixed(2)}:1`);
  }
  assert.match(readFileSync(path.join(STYLES, 'components/resultCard.css'), 'utf8'), /mark\s*\{[^}]*background:\s*var\(--color-highlight\)/);
});

test('Task 9b: the label tint tokens derive from --color-label (so a site that sets it gets matching badges), and the badges, segmented control and active filter chips use them', () => {
  const tokens = readFileSync(path.join(STYLES, 'tokens.css'), 'utf8');
  assert.match(tokens, /--color-label-tint:\s*color-mix\(in srgb, var\(--color-label\) \d+%, var\(--color-card\)\);/);
  assert.match(tokens, /--color-label-on-tint:\s*color-mix\(in srgb, var\(--color-label\) \d+%, var\(--color-ink\)\);/);
  const uses = (/** @type {string} */ file, /** @type {string} */ selector) => {
    const css = readFileSync(path.join(STYLES, 'primitives', file), 'utf8');
    const block = css.slice(css.indexOf(`${selector} {`));
    return block.slice(0, block.indexOf('}'));
  };
  // Styling system Task 12: the count badge is badge--accent, the view
  // switch's chosen option is the segmented primitive's pressed option,
  // and the active filter chips are chip--on.
  for (const [file, selector] of [['badge.css', '.badge--accent'], ['segmented.css', '.segmented__option[aria-pressed="true"],\n.segmented__option[aria-current="page"]'],
    ['chip.css', '.chip--on']]) {
    const block = uses(file, selector);
    assert.match(block, /background:\s*var\(--color-label-tint\)/, `${selector} background`);
    assert.match(block, /color:\s*var\(--color-label-on-tint\)/, `${selector} text`);
  }
  allHave(classesOf(composeHome(HOME), '.c-event-card__count'), 'badge--accent', 'home event card counts');
  const person = composePerson(PERSON);
  allHave(classesOf(person, '.c-hub__seg'), 'segmented', 'the view switch');
  allHave(classesOf(person, '.c-hub__seg [aria-pressed="true"]'), 'segmented__option', 'the chosen view');
  allHave(classesOf(person, '[data-action="remove-filter"]'), 'chip--on', 'the active filter chip');
});
