// @ts-check
/**
 * Spike (Plan 1a, Task 2, Step 1): proves a tweet's smallest mp4 video
 * variant can be range-requested directly from video.twimg.com with a
 * neutral `Referer`, which is what the engine's `<video>` embed relies on.
 *
 * Reads only the `video_info.variants` shape of the given `.syn.json`
 * fixture to pick a URL; it never prints or copies any tweet text.
 *
 * Run: node scripts/spikes/video.mjs <syn.json path>
 */
import { readFile } from 'node:fs/promises';

/**
 * @typedef {{ content_type: string, url: string, bitrate?: number }} Variant
 */

/**
 * Extracts the mp4 variants (with a bitrate) out of a syndication-style
 * tweet fixture's `mediaDetails[].video_info.variants`.
 * @param {unknown} tweet
 * @returns {Variant[]}
 */
function mp4VariantsOf(tweet) {
  const mediaDetails = Array.isArray(/** @type {any} */ (tweet)?.mediaDetails)
    ? /** @type {any} */ (tweet).mediaDetails
    : [];
  /** @type {Variant[]} */
  const variants = [];
  for (const media of mediaDetails) {
    const candidates = media?.video_info?.variants;
    if (!Array.isArray(candidates)) continue;
    for (const candidate of candidates) {
      if (candidate.content_type === 'video/mp4' && typeof candidate.bitrate === 'number') {
        variants.push(candidate);
      }
    }
  }
  return variants;
}

/**
 * @param {Variant[]} variants
 * @returns {Variant}
 */
function smallest(variants) {
  if (variants.length === 0) throw new Error('No mp4 variant with a bitrate was found in the fixture.');
  return variants.reduce((min, variant) => (/** @type {number} */ (variant.bitrate) < /** @type {number} */ (min.bitrate) ? variant : min));
}

/**
 * @param {Buffer} bytes
 * @returns {boolean}
 */
function hasFtypBox(bytes) {
  return bytes.includes('ftyp');
}

/**
 * Range-requests `url` with the given extra headers and prints the result.
 * `Range` is always sent; `label` identifies which Referer variant this is.
 * @param {string} label
 * @param {string} url
 * @param {Record<string, string>} extraHeaders
 */
async function probe(label, url, extraHeaders) {
  const response = await fetch(url, { headers: { Range: 'bytes=0-1023', ...extraHeaders } });
  const bytes = Buffer.from(await response.arrayBuffer());
  console.log(`\n--- ${label} ---`);
  console.log('status:', response.status);
  console.log('content-type:', response.headers.get('content-type'));
  console.log('content-range:', response.headers.get('content-range'));
  console.log('bytes received:', bytes.length);
  console.log('ftyp box present:', hasFtypBox(bytes));
}

async function main() {
  const fixturePath = process.argv[2];
  if (!fixturePath) {
    console.error('Usage: node scripts/spikes/video.mjs <syn.json path>');
    process.exitCode = 1;
    return;
  }

  const tweet = JSON.parse(await readFile(fixturePath, 'utf8'));
  const variant = smallest(mp4VariantsOf(tweet));
  console.log('bitrate:', variant.bitrate);

  // The ruling's literal evidence request.
  await probe('Referer: https://example.com/', variant.url, { Referer: 'https://example.com/' });
  // What a real `<video referrerpolicy="no-referrer">` actually sends (no
  // Referer header at all -- see the HTML spec's "no-referrer" referrer
  // policy, https://html.spec.whatwg.org/multipage/urls-and-fetching.html#referrer-policy-attribute),
  // kept as a second data point in case the first differs from it.
  await probe('no Referer header (no-referrer policy)', variant.url, {});
}

main();
