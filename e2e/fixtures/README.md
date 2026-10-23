# e2e/fixtures

`tiny-clip.webm` (938 bytes) and `tiny.png` (136 bytes): synthetic, invented
media for `e2e/smoke.spec.js` to stub the solluna seed's (also synthetic)
`video.twimg.com`/`pbs.twimg.com` URLs with, instead of their real 404.
Neither file is, or is derived from, a real tweet's media.

Made with the Playwright-installed Chromium itself (no `ffmpeg` available,
and no network fetch of a third-party sample file):

```js
const canvas = document.createElement('canvas');
canvas.width = 64; canvas.height = 64;
const ctx = canvas.getContext('2d');
const stream = canvas.captureStream(12);
const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 80000 });
// ...collect ondataavailable chunks...
recorder.start(100);
let frame = 0;
const draw = () => {
  frame += 1;
  ctx.fillStyle = `hsl(${(frame * 11) % 360}, 60%, 35%)`;
  ctx.fillRect(0, 0, 64, 64);
  requestAnimationFrame(draw);
};
draw();
// after ~700ms: recorder.stop(), save the resulting Blob.
```

`tiny.png` is a single flat-colour 32x32 `canvas.toDataURL('image/png')`.

Before committing `tiny-clip.webm`, it was fed to a real `<video>` (via
`page.route().fulfill({ path: ... })`) in three separate fresh browser
instances and confirmed to reach `readyState 4` (`HAVE_ENOUGH_DATA`,
`duration: 0.671`) every time -- a single static frame (no redraw loop)
did not decode reliably, which is why the recording loop above redraws
on every frame while `MediaRecorder` is running, rather than recording
one still frame.
