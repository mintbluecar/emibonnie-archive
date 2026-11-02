// @ts-check
/**
 * The grid primitive's settings (`--grid-min`, `--grid-gap` and their
 * `-wide` pair) are custom properties `.grid` defines on itself, so a
 * screen adjusts them by setting them on its own class. That only works
 * if the primitives layer comes before components (a component's
 * `--grid-min` then wins over the primitive's own) and the primitive
 * really defines each setting on `.grid`. Reads sources only -- `npm test`
 * runs without a build.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { LAYER_ORDER } from '../../scripts/buildAssets.js';

const GRID_CSS_PATH = 'src/styles/primitives/grid.css';

/** `.grid { ... }` rule bodies in a CSS source, comments stripped. @param {string} css @returns {string[]} */
function gridRuleBodies(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...stripped.matchAll(/(?:^|[}\s])\.grid\s*\{([^}]*)\}/g)].map((match) => match[1]);
}

test('LAYER_ORDER puts primitives before components, so a screen\'s grid setting wins', () => {
  const primitives = LAYER_ORDER.indexOf('primitives');
  const components = LAYER_ORDER.indexOf('components');
  assert.ok(primitives !== -1 && components !== -1, `LAYER_ORDER: ${LAYER_ORDER.join(', ')}`);
  assert.ok(primitives < components, `LAYER_ORDER: ${LAYER_ORDER.join(', ')}`);
});

test('grid.css defines each setting on .grid itself', () => {
  const bodies = gridRuleBodies(readFileSync(GRID_CSS_PATH, 'utf8'));
  assert.ok(bodies.length > 0, 'grid.css has no .grid rule');
  const defined = bodies.join('\n');
  for (const setting of ['--grid-min', '--grid-gap', '--grid-min-wide', '--grid-gap-wide']) {
    assert.match(defined, new RegExp(`${setting}\\s*:`), `.grid does not define ${setting}`);
  }
});
