/**
 * xAI's unified adapters, one per category: `image` (Grok Imagine, POST
 * /v1/images/generations) and `video` (Grok Imagine, POST
 * /v1/videos/generations).
 *
 * A barrel over two modules for the reason `openai/unified.ts` states — one
 * module per category is what keeps each ready-made pack paying only for the
 * endpoint it calls.
 */
export { image, type XaiImageResult, type XaiImageWire } from "./unified-image";
export { video, type XaiVideoResult, type XaiVideoWire } from "./unified-video";
