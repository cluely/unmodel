/**
 * Google's unified adapters, one per category: `image` (Imagen
 * `models.{model}:predict`) and `video` (Veo `models.{model}:predictLongRunning`).
 *
 * A barrel over two modules rather than one file with two exports, for the
 * reason `openai/unified.ts` states: `unmodel/image` and `unmodel/video` both
 * reach this provider, and neither should pay for the other's catalog — the
 * Imagen tables and the Veo ones are separate files behind separate adapters.
 * Import this subpath to get both; the ready-made packs import the halves.
 */
export { image, type GoogleImageResult, type GoogleImageWire } from "./unified-image";
export { video, type GoogleVideoResult, type GoogleVideoWire } from "./unified-video";
