// @ts-check
/**
 * Playwright global setup (Plan 1b Task 7 brief, ruling 2): generates two
 * tiny, genuinely valid media fixtures once, before any spec runs, so the
 * non-playback item-page checks (the sticky media area, the vertical
 * `LIVE` clip's 40% height cap, `PHOTO`'s two images) have something real
 * to stub the solluna seed's synthetic (404ing) `video.twimg.com` /
 * `pbs.twimg.com` URLs with -- instead of the `sourceGone` fallback a real
 * 404 would eventually produce (videoPlayer.js's `bind()`).
 *
 * No `ffmpeg` is available in this environment, and no committed binary
 * fixture is used either (only real, licensed, or fandom content should
 * ever be "a real video" here -- see smoke.spec.js's header). Instead,
 * the already-installed Playwright Chromium renders a plain `<canvas>`,
 * captures it with `canvas.captureStream()`, and records a fraction of a
 * second of it with `MediaRecorder` -- both standard, spec'd Web APIs
 * (https://www.w3.org/TR/mediacapture-fromelement/,
 * https://www.w3.org/TR/mediastream-recording/) -- to produce a few
 * hundred bytes of real, decodable WebM/PNG. Written under
 * `test/e2e/.generated/` (gitignored), regenerated every run.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GENERATED_DIR = fileURLToPath(new URL('.generated/', import.meta.url));
export const TINY_VIDEO_PATH = path.join(GENERATED_DIR, 'tiny.webm');
export const TINY_IMAGE_PATH = path.join(GENERATED_DIR, 'tiny.png');

/** Base64 bytes of a flat-colour canvas captured as a short clip, then as a still frame. @param {import('playwright-core').Page} page */
async function captureFixtures(page) {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    ctx.fillStyle = '#102030';
    ctx.fillRect(0, 0, 64, 64);
    const toBase64 = (/** @type {ArrayBuffer} */ buf) => {
      let binary = '';
      for (const byte of new Uint8Array(buf)) binary += String.fromCharCode(byte);
      return btoa(binary);
    };
    const png = toBase64(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer());
    const stream = canvas.captureStream(10);
    /** @type {Blob[]} */
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start();
    await new Promise((resolve) => { setTimeout(resolve, 400); });
    recorder.stop();
    await stopped;
    const webm = toBase64(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
    return { png, webm };
  });
}

export default async function globalSetup() {
  mkdirSync(GENERATED_DIR, { recursive: true });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const { png, webm } = await captureFixtures(page);
    writeFileSync(TINY_IMAGE_PATH, Buffer.from(png, 'base64'));
    writeFileSync(TINY_VIDEO_PATH, Buffer.from(webm, 'base64'));
  } finally {
    await browser.close();
  }
}
