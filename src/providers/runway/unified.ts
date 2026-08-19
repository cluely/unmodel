/**
 * Runway's unified adapters, one per category: `image` (POST /v1/text_to_image)
 * and `video` (the three video routes).
 *
 * A barrel over two modules for the reason `openai/unified.ts` states — one
 * module per category is what keeps each ready-made pack paying only for the
 * endpoints it calls.
 */
export { image, type RunwayImageResult, type RunwayImageWire } from "./unified-image";
export { video, type RunwayVideoResult, type RunwayVideoWire } from "./unified-video";
