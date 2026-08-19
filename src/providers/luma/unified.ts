/**
 * Luma's unified adapters, one per category: `image` (Photon, POST
 * /generations/image) and `video` (Ray, POST /generations).
 *
 * A barrel over two modules for the reason `openai/unified.ts` states — one
 * module per category is what keeps each ready-made pack paying only for the
 * endpoint it calls.
 */
export { image, type LumaImageResult, type LumaImageWire } from "./unified-image";
export { video, type LumaVideoResult, type LumaVideoWire } from "./unified-video";
