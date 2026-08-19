/**
 * Vidu's unified adapters, one per category: `image` (reference-to-image) and
 * `video` (the three video routes).
 *
 * A barrel over two modules for the reason `openai/unified.ts` states — one
 * module per category is what keeps each ready-made pack paying only for the
 * endpoints it calls.
 */
export { image, type ViduImageResult, type ViduImageWire } from "./unified-image";
export { video, type ViduVideoResult, type ViduVideoWire } from "./unified-video";
