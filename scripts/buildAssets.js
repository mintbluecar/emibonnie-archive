// @ts-check
/**
 * The non-JS half of the bundling step: the shared `app.css` (tokens,
 * base, primitives, layout, components, the site's theme -- each in its
 * own cascade layer, see `LAYER_ORDER`/`layerOf` below), the self-hosted
 * font files + their `@font-face` CSS, and the content hashing both
 * share. `scripts/buildBundle.js` adds esbuild's page JS and ties this
 * together with `manifest.json` and the HTML placeholder rewrite.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as esbuild from 'esbuild';
import { findFontFamilyReferences } from './buildChecks.js';

/** @typedef {{ family: string, pkg: string, fileStem: string, subsets: string[], weights: number[] }} FontSpec */
/** @typedef {{ family: string, weight: number, style: 'normal'|'italic', fileName: string, unicodeRange: string|null }} FontFace */

/**
 * Fonts this engine self-hosts (`@fontsource/*`, dev dependencies), one
 * per CSS font-stack token. A family only gets the weights it actually
 * ships at (IBM Plex Sans Thai has no 800); nothing here forces a
 * missing weight to exist. Exported so the theme test (spec "2b. Fonts
 * a site can choose") can build its allowed-families list without
 * duplicating the names.
 * @type {FontSpec[]}
 */
export const FONT_SPECS = [
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

/** @param {string|Buffer} content @returns {string} a short, stable content hash for cache-busting filenames */
export function contentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 10);
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
 * `app.css`'s cascade layers, declared once, in this order (the spec,
 * "1. Layers, applied by the build"): the site's `theme` sits right
 * after `tokens` so it can only ever beat `tokens`, never an unlayered
 * rule's absence of a layer -- an unlayered theme would otherwise win
 * over the engine's dark-mode blocks in `tokens.css`
 * (`:root:not([data-theme="light"])`/`:root[data-theme="dark"]`),
 * forcing a site's light colours into dark mode. Exported so tests can
 * assert on it without duplicating the literal list.
 * @type {string[]}
 */
export const LAYER_ORDER = ['tokens', 'theme', 'base', 'primitives', 'layout', 'components'];

/**
 * The cascade layer a build CSS source belongs to, decided from its path
 * alone (so authors never write `@layer` themselves): `tokens.css` ->
 * tokens, `base.css` -> base, `layout.css` -> layout, anything named
 * `theme.css` (the site's own, copied in by `scripts/build.js`) ->
 * theme, anything under a `primitives/` folder -> primitives, anything
 * under a `components/` folder -> components.
 * @param {string} filePath
 * @returns {string}
 */
export function layerOf(filePath) {
  const segments = filePath.split(path.sep);
  const base = segments[segments.length - 1];
  const dir = segments[segments.length - 2];
  if (base === 'tokens.css') return 'tokens';
  if (base === 'base.css') return 'base';
  if (base === 'layout.css') return 'layout';
  if (base === 'theme.css') return 'theme';
  if (dir === 'primitives') return 'primitives';
  if (dir === 'components') return 'components';
  throw new Error(`build failed: ${filePath} doesn't match any known cascade layer`);
}

/**
 * The engine CSS sources that make up `app.css`, in this order: tokens,
 * base, any `src/styles/primitives/*.css` (sorted), layout, any
 * `src/styles/components/*.css` (sorted, Task 2), then the site's own
 * `theme.css` last (so it can only override, never add, per
 * `src/styles/tokens.css`'s own doc comment). The build wraps each of
 * these in its own `@layer` by folder (`buildAppCss`), so this
 * concatenation order is cosmetic -- the layer order declared once, up
 * front, is what actually decides the cascade.
 * @param {string} repoRoot @param {string|null} siteThemePath
 * @returns {string[]}
 */
function collectAppCssSources(repoRoot, siteThemePath) {
  const stylesDir = path.join(repoRoot, 'src/styles');
  const files = ['tokens.css', 'base.css'].map((name) => path.join(stylesDir, name));
  const primitivesDir = path.join(stylesDir, 'primitives');
  if (existsSync(primitivesDir)) {
    const sorted = readdirSync(primitivesDir).filter((f) => f.endsWith('.css')).sort();
    files.push(...sorted.map((f) => path.join(primitivesDir, f)));
  }
  files.push(path.join(stylesDir, 'layout.css'));
  const componentsDir = path.join(stylesDir, 'components');
  if (existsSync(componentsDir)) {
    const sorted = readdirSync(componentsDir).filter((f) => f.endsWith('.css')).sort();
    files.push(...sorted.map((f) => path.join(componentsDir, f)));
  }
  if (siteThemePath && existsSync(siteThemePath)) files.push(siteThemePath);
  return files.filter(existsSync);
}

/**
 * Wraps one source file's text in its cascade layer, failing loudly (and
 * naming the file) if the source already declares `@layer` itself --
 * layers are assigned by folder, by the build, never by hand (globals.md:
 * "nobody writes `@layer` by hand").
 * @param {string} file @param {string} text
 * @returns {string}
 */
function wrapInLayer(file, text) {
  if (/@layer\b/.test(text)) {
    throw new Error(`build failed: ${file} declares @layer itself; cascade layers are assigned by folder, by the build`);
  }
  return `@layer ${layerOf(file)} {\n${text}\n}`;
}

/**
 * Builds the one shared, minified, content-hashed `app-<hash>.css`,
 * assembled in cascade layers: the layer order declared once, first,
 * then each source wrapped in its layer by `wrapInLayer`. esbuild's CSS
 * minifier keeps `@layer` statements and blocks intact.
 * @param {string} repoRoot @param {string} outDir @param {string|null} siteThemePath
 * @returns {string} the filename written under `outDir`
 */
export function buildAppCss(repoRoot, outDir, siteThemePath) {
  const sources = collectAppCssSources(repoRoot, siteThemePath);
  const layerStatement = `@layer ${LAYER_ORDER.join(', ')};`;
  const layered = sources.map((file) => wrapInLayer(file, readFileSync(file, 'utf8')));
  const concatenated = [layerStatement, ...layered].join('\n');
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
 * Copies every weight/subset a font spec ships into `fontsDir`, each
 * renamed to `<original-stem>-<hash>.woff2` -- `/build/*` is cached
 * `immutable` for a year, so a same-named `@fontsource` update (a new
 * version shipping different bytes under the same filename) must still
 * reach visitors as a new URL, the same as `app.css`/`fonts.css`.
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
      const bytes = readFileSync(src);
      const fileName = `${path.basename(src, '.woff2')}-${contentHash(bytes)}.woff2`;
      writeFileSync(path.join(fontsDir, fileName), bytes);
      faces.push({ family: spec.family, weight, style: 'normal', fileName, unicodeRange: spec.subsets.length > 1 ? UNICODE_RANGES[subset] : null });
    }
  }
  return faces;
}

/** @param {FontFace} face @returns {string} */
function fontFaceRule(face) {
  const range = face.unicodeRange ? `\n  unicode-range: ${face.unicodeRange};` : '';
  return (
    `@font-face {\n  font-family: '${face.family}';\n  font-style: ${face.style};\n  font-weight: ${face.weight};` +
    `\n  font-display: swap;\n  src: url('./fonts/${face.fileName}') format('woff2');${range}\n}`
  );
}

/**
 * The bytes of one site font's `files[]` entry, read from
 * `site/fonts/<path>`. Fails loudly, naming the font and the missing
 * file, rather than silently shipping fewer faces than declared.
 * @param {string} siteDir @param {string} family @param {{ path: string }} file
 * @returns {Buffer}
 */
function siteFontFileBytes(siteDir, family, file) {
  const absPath = path.join(siteDir, 'fonts', file.path);
  if (!existsSync(absPath)) {
    throw new Error(`build failed: site font '${family}' names file '${file.path}', which isn't in site/fonts/`);
  }
  return readFileSync(absPath);
}

/**
 * `FontFace[]` for one site font shipped from its own `site/fonts/*.woff2`
 * files (docs/site-settings.md, "Fonts"), each copied in and content-hashed
 * the same way the engine's own fonts are.
 * @param {string} siteDir @param {string} fontsDir @param {import('../src/site/schema.js').SiteFont} font
 * @returns {FontFace[]}
 */
function siteFontFacesFromFiles(siteDir, fontsDir, font) {
  if (!('files' in font)) return [];
  return font.files.map((file) => {
    const bytes = siteFontFileBytes(siteDir, font.family, file);
    const fileName = `${path.basename(file.path, '.woff2')}-${contentHash(bytes)}.woff2`;
    writeFileSync(path.join(fontsDir, fileName), bytes);
    return { family: font.family, weight: file.weight, style: file.style, fileName, unicodeRange: file.unicodeRange ?? null };
  });
}

/**
 * `FontFace[]` for one site font shipped from an `@fontsource/*` package
 * the site installed as its own dev dependency. Fails loudly, naming the
 * font, the package and the missing weight, if the package doesn't ship
 * one of the requested weights at any of the requested subsets.
 * @param {string} engineRoot @param {string} fontsDir @param {import('../src/site/schema.js').SiteFont} font
 * @returns {FontFace[]}
 */
function siteFontFacesFromPackage(engineRoot, fontsDir, font) {
  if (!('package' in font)) return [];
  const fileStem = font.package.replace(/^@fontsource\//, '');
  /** @type {FontFace[]} */
  const faces = [];
  for (const weight of font.weights) {
    const shippedBefore = faces.length;
    for (const subset of font.subsets) {
      const file = path.join(engineRoot, 'node_modules', font.package, 'files', `${fileStem}-${subset}-${weight}-${font.style}.woff2`);
      if (!existsSync(file)) continue;
      const bytes = readFileSync(file);
      const fileName = `${path.basename(file, '.woff2')}-${contentHash(bytes)}.woff2`;
      writeFileSync(path.join(fontsDir, fileName), bytes);
      faces.push({ family: font.family, weight, style: font.style, fileName, unicodeRange: font.subsets.length > 1 ? (UNICODE_RANGES[subset] ?? null) : null });
    }
    if (faces.length === shippedBefore) {
      throw new Error(`build failed: site font '${font.family}' (${font.package}) doesn't ship weight ${weight}`);
    }
  }
  return faces;
}

/**
 * The site fonts (spec "2b. Fonts a site can choose") that some custom
 * property in `tokensCss` or the site's own `theme.css` actually names
 * -- "a site family that's never pointed at by a token isn't shipped".
 * @param {import('../src/site/schema.js').SiteFont[]} fonts @param {string} tokensCss @param {string} themeCss
 * @returns {import('../src/site/schema.js').SiteFont[]}
 */
function fontsPointedAtBy(fonts, tokensCss, themeCss) {
  const referenced = [...findFontFamilyReferences([tokensCss, themeCss])].map((name) => name.toLowerCase());
  return fonts.filter((font) => referenced.includes(font.family.toLowerCase()));
}

/**
 * Copies the engine's self-hosted font files into `outDir/fonts/`, plus
 * any of the site's own `site.json` `fonts` (`options.fonts`) that some
 * token in `tokens.css` or the site's `theme.css` (under
 * `options.siteDir`) actually names, and builds the content-hashed
 * `fonts-<hash>.css` of `@font-face` rules for all of them. A site with
 * no `fonts` (or a `fonts` entry no token ever points at) ships only
 * the engine's own families (Review Focus 5).
 * @param {string} engineRoot @param {string} outDir
 * @param {{ siteDir?: string, fonts?: import('../src/site/schema.js').SiteFont[] }} [options]
 * @returns {string} the filename written under `outDir`
 */
export function buildFontsCss(engineRoot, outDir, { siteDir, fonts = [] } = {}) {
  const fontsDir = path.join(outDir, 'fonts');
  mkdirSync(fontsDir, { recursive: true });
  const faces = FONT_SPECS.flatMap((spec) => copyOneFontSpec(engineRoot, fontsDir, spec));

  if (fonts.length > 0 && siteDir) {
    const tokensCss = readFileSync(path.join(engineRoot, 'src/styles/tokens.css'), 'utf8');
    const themeCssPath = path.join(siteDir, 'theme.css');
    const themeCss = existsSync(themeCssPath) ? readFileSync(themeCssPath, 'utf8') : '';
    for (const font of fontsPointedAtBy(fonts, tokensCss, themeCss)) {
      faces.push(...siteFontFacesFromFiles(siteDir, fontsDir, font));
      faces.push(...siteFontFacesFromPackage(engineRoot, fontsDir, font));
    }
  }

  const css = `${faces.map(fontFaceRule).join('\n\n')}\n`;
  return writeHashedAsset(outDir, 'fonts', 'css', css);
}
