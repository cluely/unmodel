/**
 * Stability's unified adapters, one per category: `image` (the three Stable
 * Image generation routes), `imageEdit` (POST
 * /v2beta/stable-image/edit/remove-background) and `music` (POST
 * /v2beta/audio/stable-audio-2/text-to-audio).
 *
 * A barrel over three modules rather than one file with three exports, because
 * `unmodel/image`, `unmodel/image-edit` and `unmodel/music` all reach this
 * provider and none should pay for another's validator or catalog. Import this
 * subpath to get all three; the ready-made packs import the leaves directly.
 */
export { image, type StabilityImageResult, type StabilityImageWire } from "./unified-image";
export {
  imageEdit,
  type StabilityImageEditResult,
  type StabilityImageEditWire,
} from "./unified-image-edit";
export { music, type StabilityMusicResult, type StabilityMusicWire } from "./unified-music";
