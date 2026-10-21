// @ts-check
import { VIDEO_CACHE } from '../http/handler.js';
import { NotFound } from '../http/errors.js';
import { videoVariants } from '../services/itemPage.js';

/** `GET /api/video/:kind/:sourceId`: `{ variants }` from the stored media, while the item is visible and its clip is live. */
export const route = {
  method: 'GET',
  path: '/api/video/:kind/:sourceId',
  cache: VIDEO_CACHE,
  /** @param {import('../http/handler.js').RouteInput} input @param {any} deps */
  run: async ({ params }, deps) => {
    const video = await videoVariants(deps, params.kind, params.sourceId);
    if (!video) throw new NotFound();
    return video;
  },
};
