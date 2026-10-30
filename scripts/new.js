// @ts-check
/**
 * `npm run new <kind> <name>`: scaffolds an extension point from
 * `scripts/templates/` (the plans are in `scripts/newPlans.js`; the
 * recipes in CONTRIBUTING.md say what to do next). Kinds:
 *
 *   route      src/routes/<name>.js + its test, registered in src/routes/index.js
 *   page       src/html/<name>.html, public/js/pages/<name>.js + its test, src/pages.js entry, copy keys
 *   component  public/js/components/<name>.js + its test
 *   migration  src/db/migrations/<NNN>_<name>.sql (`-- --site`: <SITE_DIR>/migrations/)
 *   kind       src/kinds/<name>/, public/js/kinds/<name>/, its migration and tests
 *
 * Names match `^[a-z][a-z0-9_]*$` (files are camelCased, URLs dashed).
 * Never overwrites: every conflict is found before anything is written,
 * and the CLI exits 1 with the reason.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTES, PLANS, varsOf } from './newPlans.js';
import { RESERVED_WORDS } from './newChecks.js';
import { siteDirOf } from './cli.js';

const TEMPLATES = fileURLToPath(new URL('./templates/', import.meta.url));
const NAME = /^[a-z][a-z0-9_]*$/;
const PLACEHOLDER = /__(name|camel|Pascal|dash|NNN)__/g;
const USAGE = 'usage: npm run new <route|page|component|migration|kind> <name>  (migration: npm run new -- migration <name> --site)';

/** @param {string} text @param {import('./newPlans.js').Vars} vars @returns {string} */
function render(text, vars) {
  return text.replace(PLACEHOLDER, (_whole, key) => vars[/** @type {keyof import('./newPlans.js').Vars} */ (key)]);
}

/**
 * Scaffolds one extension point under `root`.
 * @param {{ kind: string, name: string, root?: string, site?: boolean, siteDir?: string }} request
 * @returns {string[]} every created or edited path, relative to `root`, in order
 */
export function scaffold({ kind, name, root = '.', site = false, siteDir = siteDirOf(process.env) }) {
  if (!Object.hasOwn(PLANS, kind)) throw new Error(`unknown scaffold "${kind}": use one of ${Object.keys(PLANS).join(', ')}`);
  if (!NAME.test(name)) throw new Error(`name must match ^[a-z][a-z0-9_]*$: "${name}"`);
  const vars = varsOf(name);
  if (RESERVED_WORDS.has(vars.camel)) throw new Error(`"${name}" is a JavaScript reserved word (it becomes the identifier ${vars.camel}); pick another name`);
  const plan = PLANS[kind](vars, { root, site, siteDir });
  const taken = plan.files.filter((f) => existsSync(path.join(root, f.target))).map((f) => `${f.target} already exists`);
  const conflicts = [...taken, ...plan.conflicts];
  if (conflicts.length > 0) throw new Error(`refusing to scaffold ${kind} ${name}: ${conflicts.join('; ')}`);

  const rendered = plan.files.map((f) => ({ target: f.target, text: render(readFileSync(path.join(TEMPLATES, f.template), 'utf8'), vars) }));
  const edited = plan.edits.map((e) => ({ target: e.target, text: e.apply(readFileSync(path.join(root, e.target), 'utf8')) }));
  for (const { target, text } of [...rendered, ...edited]) {
    mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
    writeFileSync(path.join(root, target), text);
  }
  return [...rendered, ...edited].map((f) => f.target);
}

/** What to do next that a scaffold can't do itself (e.g. a route's privacy-sweep entry). @param {string} kind @param {string} name @returns {string[]} */
export function notesFor(kind, name) {
  return Object.hasOwn(NOTES, kind) ? NOTES[kind](varsOf(name)) : [];
}

/** @param {string[]} argv @returns {void} */
function main(argv) {
  const site = argv.includes('--site');
  const [kind, name, ...rest] = argv.filter((arg) => arg !== '--site');
  if (!kind || !name || rest.length > 0) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  try {
    for (const target of scaffold({ kind, name, site })) console.log(`wrote ${target}`);
    for (const note of notesFor(kind, name)) console.log(note);
    console.log(`next: follow the "${kind}" recipe in CONTRIBUTING.md, then npm run build && npm run check && npm test`);
  } catch (/** @type {any} */ err) {
    console.error(err.message ?? String(err));
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
