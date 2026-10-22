// @ts-check
/**
 * What each `npm run new <kind> <name>` scaffold creates and edits
 * (`scripts/new.js` carries it out). A plan is pure data: the files to
 * render from `scripts/templates/<kind>/`, the existing files to edit
 * (each an insertion at a marked line), and any conflict that must stop
 * the run before anything is written.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { RESERVED_URL_PREFIXES } from '../src/kinds/defineKind.js';

/**
 * @typedef {{ name: string, camel: string, Pascal: string, dash: string, NNN: string }} Vars
 * @typedef {{ template: string, target: string }} FileStep
 * @typedef {{ target: string, apply: (text: string) => string }} EditStep
 * @typedef {{ files: FileStep[], edits: EditStep[], conflicts: string[] }} Plan
 * @typedef {{ root: string, site: boolean, siteDir: string }} PlanOptions
 */

export const ROUTE_IMPORTS_MARKER = '// scaffold:route-imports';
export const ROUTES_MARKER = '// scaffold:routes';
export const PAGES_MARKER = '// scaffold:pages';
const ENGINE_MIGRATIONS = 'src/db/migrations';

/** @param {string} name @returns {Vars} */
export function varsOf(name) {
  const camel = name.replace(/_+([a-z0-9])/g, (_m, ch) => ch.toUpperCase());
  return { name, camel, Pascal: camel[0].toUpperCase() + camel.slice(1), dash: name.replaceAll('_', '-'), NNN: '' };
}

/**
 * Inserts `line` just above the marker line, at the marker's indentation.
 * @param {string} text @param {string} marker @param {string} line @param {string} target
 * @returns {string}
 */
export function insertAbove(text, marker, line, target) {
  const match = new RegExp(`^([ \\t]*)${marker.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`, 'm').exec(text);
  if (!match) throw new Error(`${target} has no "${marker}" line to insert at`);
  return `${text.slice(0, match.index)}${match[1]}${line}\n${text.slice(match.index)}`;
}

/**
 * The next free `NNN` in a migrations directory, and any existing file
 * already named `_<name>.sql` there.
 * @param {string} dir @param {string} name
 * @returns {{ NNN: string, clash: string|null }}
 */
function nextMigration(dir, name) {
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)) : [];
  const last = files.reduce((max, f) => Math.max(max, Number(f.slice(0, 3))), 0);
  const clash = files.find((f) => f.slice(4) === `${name}.sql`) ?? null;
  return { NNN: String(last + 1).padStart(3, '0'), clash };
}

/**
 * @param {string} dirRel @param {Vars} vars @param {PlanOptions} options @param {string} template
 * @returns {{ step: FileStep, conflicts: string[] }}
 */
function migrationStep(dirRel, vars, options, template) {
  const { NNN, clash } = nextMigration(path.join(options.root, dirRel), vars.name);
  vars.NNN = NNN;
  return {
    step: { template, target: `${dirRel}/${NNN}_${vars.name}.sql` },
    conflicts: clash ? [`${dirRel}/${clash} already exists`] : [],
  };
}

/** @param {Vars} v @returns {Plan} */
function routePlan(v) {
  const index = 'src/routes/index.js';
  return {
    files: [
      { template: 'route/route.js.tmpl', target: `src/routes/${v.camel}.js` },
      { template: 'route/route.test.js.tmpl', target: `test/routes/${v.camel}.test.js` },
    ],
    edits: [{
      target: index,
      apply: (text) => insertAbove(
        insertAbove(text, ROUTE_IMPORTS_MARKER, `import { route as ${v.camel} } from './${v.camel}.js';`, index),
        ROUTES_MARKER, `${v.camel},`, index,
      ),
    }],
    conflicts: [],
  };
}

/** @param {Vars} v @param {PlanOptions} options @returns {Plan} */
function pagePlan(v, options) {
  const pagesFile = 'src/pages.js';
  const copyFile = 'src/site/copyDefaults.json';
  const keys = { [`${v.camel}.title`]: v.name.replaceAll('_', ' '), [`${v.camel}.empty`]: 'nothing here yet' };
  const pagesText = readFileSync(path.join(options.root, pagesFile), 'utf8');
  const copy = JSON.parse(readFileSync(path.join(options.root, copyFile), 'utf8'));
  return {
    files: [
      { template: 'page/page.html.tmpl', target: `public/${v.dash}.html` },
      { template: 'page/page.js.tmpl', target: `public/js/pages/${v.camel}.js` },
      { template: 'page/page.test.js.tmpl', target: `test/pages/${v.camel}.test.js` },
    ],
    edits: [
      { target: pagesFile, apply: (text) => insertAbove(text, PAGES_MARKER, `{ path: '/${v.dash}', file: '${v.dash}.html' },`, pagesFile) },
      { target: copyFile, apply: (text) => `${JSON.stringify({ ...JSON.parse(text), ...keys }, null, 2)}\n` },
    ],
    conflicts: [
      ...(pagesText.includes(`path: '/${v.dash}'`) ? [`${pagesFile} already lists /${v.dash}`] : []),
      ...Object.keys(keys).filter((key) => Object.hasOwn(copy, key)).map((key) => `${copyFile} key ${key} already exists`),
    ],
  };
}

/** @param {Vars} v @returns {Plan} */
function componentPlan(v) {
  return {
    files: [
      { template: 'component/component.js.tmpl', target: `public/js/components/${v.camel}.js` },
      { template: 'component/component.test.js.tmpl', target: `test/components/${v.camel}.test.js` },
    ],
    edits: [],
    conflicts: [],
  };
}

/** @param {Vars} v @param {PlanOptions} options @returns {Plan} */
function migrationPlan(v, options) {
  const dir = options.site ? `${options.siteDir}/migrations` : ENGINE_MIGRATIONS;
  const { step, conflicts } = migrationStep(dir, v, options, 'migration/migration.sql.tmpl');
  return { files: [step], edits: [], conflicts };
}

/** @param {Vars} v @param {PlanOptions} options @returns {Plan} */
function kindPlan(v, options) {
  const server = ['index.js', 'domain.js', 'repo.js', 'presenter.js', 'search.js', 'copy.json'];
  const { step, conflicts } = migrationStep(ENGINE_MIGRATIONS, v, options, 'kind/migration.sql.tmpl');
  const prefix = `/${v.dash}/`;
  const folders = [`src/kinds/${v.name}`, `public/js/kinds/${v.name}`, `test/kinds/${v.name}`];
  return {
    files: [
      ...server.map((file) => ({ template: `kind/${file}.tmpl`, target: `src/kinds/${v.name}/${file}` })),
      ...['section.js', 'detail.js'].map((file) => ({ template: `kind/${file}.tmpl`, target: `public/js/kinds/${v.name}/${file}` })),
      step,
      ...['domain', 'kind', 'ui'].map((file) => ({ template: `kind/${file}.test.js.tmpl`, target: `test/kinds/${v.name}/${file}.test.js` })),
    ],
    edits: [],
    conflicts: [
      ...conflicts,
      ...(RESERVED_URL_PREFIXES.includes(prefix) ? [`the URL prefix ${prefix} is reserved by the engine (src/pages.js); pick another name`] : []),
      ...folders.filter((dir) => existsSync(path.join(options.root, dir))).map((dir) => `${dir}/ already exists`),
    ],
  };
}

/** @type {Record<string, (vars: Vars, options: PlanOptions) => Plan>} */
export const PLANS = { route: routePlan, page: pagePlan, component: componentPlan, migration: migrationPlan, kind: kindPlan };
