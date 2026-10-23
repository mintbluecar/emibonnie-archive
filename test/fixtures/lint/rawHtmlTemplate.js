// @ts-check
// Fixture: a plain (untagged) template literal containing '<', the shape
// the ESLint rule in eslint.config.js (public/js/components/**,
// public/js/kinds/**) forbids. Used by test/components/eslintTemplateLiteral.test.js.
export function render(x) {
  return `<p>${x}</p>`;
}
