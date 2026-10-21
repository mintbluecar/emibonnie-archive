// @ts-check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The default (light-mode) card colour, from `src/styles/tokens.css`. */
export const DEFAULT_CARD_COLOUR = '#fffdf8';

/** Vercel serverless function region codes, as of 2026-10-21. */
export const ALLOWED_REGIONS = [
  'arn1', 'bom1', 'cdg1', 'cle1', 'cpt1', 'dub1', 'fra1', 'gru1',
  'hnd1', 'hkg1', 'iad1', 'icn1', 'kix1', 'lhr1', 'pdx1', 'sfo1',
  'sin1', 'syd1',
];

/**
 * Reads the dark-mode `--color-card` token out of `src/styles/tokens.css`,
 * so the schema's contrast check and the engine's actual dark theme can
 * never drift apart.
 * @returns {string}
 */
function readDarkCardColour() {
  const tokensPath = fileURLToPath(new URL('../styles/tokens.css', import.meta.url));
  const css = readFileSync(tokensPath, 'utf8');
  const darkIndex = css.indexOf('(prefers-color-scheme: dark)');
  const scope = darkIndex === -1 ? css : css.slice(darkIndex);
  const match = scope.match(/--color-card:\s*(#[0-9a-f]{6})/i);
  if (!match) throw new Error('src/styles/tokens.css has no dark-mode --color-card token');
  return match[1];
}

/** The dark-mode card colour, from `src/styles/tokens.css`. */
export const DARK_CARD_COLOUR = readDarkCardColour();

/**
 * @param {number} channel8bit
 * @returns {number}
 */
function srgbChannelToLinear(channel8bit) {
  const c = channel8bit / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG relative luminance of a `#rrggbb` colour.
 * @param {string} hex
 * @returns {number}
 */
function relativeLuminance(hex) {
  const r = srgbChannelToLinear(parseInt(hex.slice(1, 3), 16));
  const g = srgbChannelToLinear(parseInt(hex.slice(3, 5), 16));
  const b = srgbChannelToLinear(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio between two `#rrggbb` colours (1:1 to 21:1).
 * @param {string} hexA
 * @param {string} hexB
 * @returns {number}
 */
export function contrastRatio(hexA, hexB) {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}
