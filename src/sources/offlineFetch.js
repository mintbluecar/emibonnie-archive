// @ts-check
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * @param {URL} url
 * @returns {{kind: 'syn'|'fx'|'thread'|null, id: string|null}}
 */
function routeOf(url) {
  if (url.hostname === 'cdn.syndication.twimg.com') {
    return { kind: 'syn', id: url.searchParams.get('id') };
  }
  if (url.hostname === 'api.fxtwitter.com') {
    const [, version, kind, id] = url.pathname.split('/');
    if (version === '2' && kind === 'status') return { kind: 'fx', id: id ?? null };
    if (version === '2' && kind === 'thread') return { kind: 'thread', id: id ?? null };
  }
  return { kind: null, id: null };
}

/** @returns {Response} */
function notFound() {
  return new Response(null, { status: 404 });
}

/**
 * Builds a `fetchImpl` that serves this suite's synthetic tweet fixtures
 * from `dir` (one `<id>.syn.json`, `<id>.fx.json` and/or `<id>.thread.json`
 * per fixture), standing in for the real syndication/FxTwitter endpoints.
 * Used by `seedDev` and tests — never by production routes or services.
 * @param {string} dir
 * @returns {typeof fetch}
 */
export function offlineFetch(dir) {
  return /** @type {typeof fetch} */ (
    async function fetchImpl(input) {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const { kind, id } = routeOf(url);
      if (!kind || !id) return notFound();

      const filePath = path.join(dir, `${id}.${kind}.json`);
      if (!existsSync(filePath)) return notFound();

      return new Response(readFileSync(filePath, 'utf8'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
  );
}
