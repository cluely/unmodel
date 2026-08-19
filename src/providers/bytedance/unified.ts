/**
 * ByteDance's unified adapters, one per category: `image` (Seedream, POST
 * /images/generations) and `video` (Seedance, POST
 * /contents/generations/tasks).
 *
 * A barrel over two modules for the reason `openai/unified.ts` states — one
 * module per category is what keeps each ready-made pack paying only for the
 * endpoint it calls.
 */
export { image, type BytedanceImageResult, type BytedanceImageWire } from "./unified-image";
export { video, type BytedanceVideoResult, type BytedanceVideoWire } from "./unified-video";
