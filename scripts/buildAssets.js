// @ts-check
/**
 * The non-JS half of the bundling step: the shared `app.css` (tokens,
 * base, layout, components, the site's theme), the self-hosted font
 * files + their `@font-face` CSS, and the content hashing both share.
 * `scripts/buildBundle.js` adds esbuild's page JS and ties this together
 * with `manifest.json` and the HTML placeholder rewrite.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as esbuild from 'esbuild';

/** @typedef {{ family: string, pkg: string, fileStem: string, subsets: string[], weights: number[] }} FontSpec */
/** @typedef {{ family: string, weight: number, fileName: string, unicodeRange: string|null }} FontFace */

/**
 * Fonts this engine self-hosts (`@fontsource/*`, dev dependencies), one
 * per CSS font-stack token. A family only gets the weights it actually
 * ships at (IBM Plex Sans Thai has no 800); nothing here forces a
 * missing weight to exist.
 * @type {FontSpec[]}
 */
const FONT_SPECS = [
  { family: 'Nunito', pkg: '@fontsource/nunito', fileStem: 'nunito', subsets: ['latin'], weights: [400, 600, 700, 800] },
  {
    family: 'IBM Plex Sans Thai',
    pkg: '@fontsource/ibm-plex-sans-thai',
    fileStem: 'ibm-plex-sans-thai',
    subsets: ['latin', 'thai'],
    weights: [400, 600, 700, 800],
  },
];

/**
 * `unicode-range`s @fontsource uses for these subsets (stable across
 * weights), so same-family subsets don't shadow each other.
 * @type {Record<string, string>}
 */
const UNICODE_RANGES = {
  latin:
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
  thai: 'U+02D7,U+0303,U+0331,U+0E01-0E5B,U+200C-200D,U+25CC',
};

/** @param {string} text @returns {string} a short, stable content hash for cache-busting filenames */
export function contentHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 10);
}

/**
 * Writes `content` as `<name>-<hash>.<ext>` under `outDir` and returns
 * just that filename (for the manifest and the HTML rewrite).
 * @param {string} outDir @param {string} name @param {string} ext @param {string} content
 * @returns {string}
 */
export function writeHashedAsset(outDir, name, ext, content) {
  const fileName = `${name}-${contentHash(content)}.${ext}`;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, fileName), content);
  return fileName;
}

/**
 * The engine CSS sources that make up `app.css`, in load order: tokens,
 * base, layout, then any `src/styles/components/*.css` (Task 2), then
 * the site's own `theme.css` last (so it can only override, never add,
 * per `src/styles/tokens.css`'s own doc comment).
 * @param {string} repoRoot @param {string|null} siteThemePath
 * @returns {string[]}
 */
function collectAppCssSources(repoRoot, siteThemePath) {
  const stylesDir = path.join(repoRoot, 'src/styles');
  const files = ['tokens.css', 'base.css', 'layout.css'].map((name) => path.join(stylesDir, name));
  const componentsDir = path.join(stylesDir, 'components');
  if (existsSync(componentsDir)) {
    const sorted = readdirSync(componentsDir).filter((f) => f.endsWith('.css')).sort();
    files.push(...sorted.map((f) => path.join(componentsDir, f)));
  }
  if (siteThemePath && existsSync(siteThemePath)) files.push(siteThemePath);
  return files.filter(existsSync);
}

/**
 * Builds the one shared, minified, content-hashed `app-<hash>.css`.
 * @param {string} repoRoot @param {string} outDir @param {string|null} siteThemePath
 * @returns {string} the filename written under `outDir`
 */
export function buildAppCss(repoRoot, outDir, siteThemePath) {
  const sources = collectAppCssSources(repoRoot, siteThemePath);
  const concatenated = sources.map((file) => readFileSync(file, 'utf8')).join('\n');
  const { code } = esbuild.transformSync(concatenated, { loader: 'css', minify: true });
  return writeHashedAsset(outDir, 'app', 'css', code);
}

/**
 * The woff2 file @fontsource ships for one family/subset/weight, or
 * `null` if that family doesn't ship that weight.
 * @param {string} engineRoot @param {FontSpec} spec @param {string} subset @param {number} weight
 * @returns {string|null}
 */
function fontFilePath(engineRoot, spec, subset, weight) {
  const file = path.join(engineRoot, 'node_modules', spec.pkg, 'files', `${spec.fileStem}-${subset}-${weight}-normal.woff2`);
  return existsSync(file) ? file : null;
}

/**
 * Copies every weight/subset a font spec ships into `fontsDir`.
 * @param {string} engineRoot @param {string} fontsDir @param {FontSpec} spec
 * @returns {FontFace[]}
 */
function copyOneFontSpec(engineRoot, fontsDir, spec) {
  /** @type {FontFace[]} */
  const faces = [];
  for (const weight of spec.weights) {
    for (const subset of spec.subsets) {
      const src = fontFilePath(engineRoot, spec, subset, weight);
      if (!src) continue;
      const fileName = path.basename(src);
      copyFileSync(src, path.join(fontsDir, fileName));
      faces.push({ family: spec.family, weight, fileName, unicodeRange: spec.subsets.length > 1 ? UNICODE_RANGES[subset] : null });
    }
  }
  return faces;
}

/** @param {FontFace} face @returns {string} */
function fontFaceRule(face) {
  const range = face.unicodeRange ? `\n  unicode-range: ${face.unicodeRange};` : '';
  return (
    `@font-face {\n  font-family: '${face.family}';\n  font-style: normal;\n  font-weight: ${face.weight};` +
    `\n  font-display: swap;\n  src: url('./fonts/${face.fileName}') format('woff2');${range}\n}`
  );
}

/**
 * Copies the self-hosted font files into `outDir/fonts/` and builds the
 * content-hashed `fonts-<hash>.css` of `@font-face` rules for them.
 * @param {string} engineRoot @param {string} outDir
 * @returns {string} the filename written under `outDir`
 */
export function buildFontsCss(engineRoot, outDir) {
  const fontsDir = path.join(outDir, 'fonts');
  mkdirSync(fontsDir, { recursive: true });
  const faces = FONT_SPECS.flatMap((spec) => copyOneFontSpec(engineRoot, fontsDir, spec));
  const css = `${faces.map(fontFaceRule).join('\n\n')}\n`;
  return writeHashedAsset(outDir, 'fonts', 'css', css);
}
