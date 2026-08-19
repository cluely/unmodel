/**
 * Kling's unified adapters, one per category: `image` (the two image routes)
 * and `video` (the five video ones, across both route families).
 *
 * A barrel over two modules for the reason `openai/unified.ts` states — one
 * module per category is what keeps each ready-made pack paying only for the
 * endpoints it calls, which matters here more than anywhere: the video half
 * carries five validators.
 */
export { image, type KlingImageResult, type KlingImageWire } from "./unified-image";
export { video, type KlingVideoResult, type KlingVideoWire } from "./unified-video";
