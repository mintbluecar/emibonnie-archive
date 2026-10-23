// @ts-check
/**
 * `public/js/core/site.js` imports the absolute specifier `/site/site.js`
 * (served from `public/site/site.js` at runtime, written by
 * `scripts/build.js`; see test/core/site.test.js, which does the same
 * thing for the core tests). Component tests import this before any
 * `public/js/core` or `public/js/components` module, so that import
 * resolves to the fixture instead.
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '/site/site.js') {
      return { url: new URL('../fixtures/components/site.js', import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
