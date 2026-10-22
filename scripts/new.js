// @ts-check
/**
 * `npm run new <kind> <name>`: scaffolds an extension point from
 * `scripts/templates/` (the plans are in `scripts/newPlans.js`; the
 * recipes in CONTRIBUTING.md say what to do next). Kinds:
 *
 *   route      src/routes/<name>.js + its test, registered in src/routes/index.js
 *   page       public/<name>.html, public/js/pages/<name>.js + its test, src/pages.js entry, copy keys
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
import { PLANS, varsOf } from './newPlans.js';

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
export function scaffold({ kind, name, root = '.', site = false, siteDir = process.env.SITE_DIR ?? 'site' }) {
  if (!Object.hasOwn(PLANS, kind)) throw new Error(`unknown scaffold "${kind}": use one of ${Object.keys(PLANS).join(', ')}`);
  if (!NAME.test(name)) throw new Error(`name must match ^[a-z][a-z0-9_]*$: "${name}"`);
  const vars = varsOf(name);
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
    console.log(`next: follow the "${kind}" recipe in CONTRIBUTING.md, then npm run build && npm run check && npm test`);
  } catch (/** @type {any} */ err) {
    console.error(err.message ?? String(err));
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
