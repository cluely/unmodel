/**
 * Revana's unified adapters, one per category: `video` (every video model but
 * the two views below), `lipsync` and `avatar` (the curated clip-and-sound and
 * still-and-sound models), `image` (the models that draw from a prompt),
 * `imageEdit` (the ones that edit), `upscale`, `tts` and `music`.
 *
 * A barrel over eight modules rather than one file with eight exports, because
 * eight different category packs reach this provider and none should pay for
 * the others' rosters: the eight adapters finish in eight addresses over one
 * route, but `revana.video` carries the video catalog and `revana.image` the
 * picture one. Import this subpath to get all eight; the ready-made packs
 * import the leaves directly, and `test/bundle-budget.test.ts` measures that
 * they do.
 *
 * `revana.chat` has no adapter here: `unmodel/chat` is a different surface with
 * its own registry (`src/chat/providers.ts`).
 */
export { video, type RevanaVideoResult, type RevanaVideoWire } from "./unified-video";
export { lipsync, type RevanaLipsyncResult, type RevanaLipsyncWire } from "./unified-lipsync";
export { avatar, type RevanaAvatarResult, type RevanaAvatarWire } from "./unified-avatar";
export { image, type RevanaImageResult, type RevanaImageWire } from "./unified-image";
export {
  imageEdit,
  type RevanaImageEditResult,
  type RevanaImageEditWire,
} from "./unified-image-edit";
export { upscale, type RevanaUpscaleResult, type RevanaUpscaleWire } from "./unified-upscale";
export { tts, type RevanaTtsResult, type RevanaTtsWire } from "./unified-tts";
export { music, type RevanaMusicResult, type RevanaMusicWire } from "./unified-music";
