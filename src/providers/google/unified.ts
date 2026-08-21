/**
 * Google's unified adapters, one per category: `image` (Imagen
 * `models.{model}:predict`), `video` (Veo `models.{model}:predictLongRunning`),
 * `tts` and `stt` (both `models.{model}:generateContent`, seen through their
 * two opposite-direction windows).
 *
 * A barrel over four modules rather than one file with four exports, for the
 * reason `openai/unified.ts` states: `unmodel/image`, `unmodel/video`,
 * `unmodel/tts` and `unmodel/stt` all reach this provider, and none should pay
 * for the others' catalogs — the Imagen tables, the Veo ones, the three
 * hand-written TTS rows and the generated transcription catalog are separate
 * files behind separate adapters. Import this subpath to get all four; the
 * ready-made packs import the leaves.
 */
export { image, type GoogleImageResult, type GoogleImageWire } from "./unified-image";
export {
  stt,
  type GoogleSttResult,
  type GoogleSttWire,
  type GoogleSttWireGenerationConfig,
} from "./unified-stt";
export {
  tts,
  type GoogleTtsResult,
  type GoogleTtsWire,
  type GoogleTtsWireGenerationConfig,
} from "./unified-tts";
export { video, type GoogleVideoResult, type GoogleVideoWire } from "./unified-video";
