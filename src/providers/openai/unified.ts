/**
 * OpenAI's unified adapters, one per category: `tts` (POST
 * /v1/audio/speech), `image` (POST /v1/images/generations), `imageEdit` (POST
 * /v1/images/edits), `video` (POST /v1/videos — Sora 2) and `stt` (POST
 * /v1/audio/transcriptions).
 *
 * A barrel over five modules rather than one file with five exports, because
 * `unmodel/tts`, `unmodel/image`, `unmodel/image-edit`, `unmodel/video` and
 * `unmodel/stt` all reach this provider and none should pay for the
 * others' catalogs. Import this subpath to get all five; the ready-made packs
 * import the halves directly.
 */
export { tts, type OpenaiTtsResult, type OpenaiTtsWire } from "./unified-tts";
export { image, type OpenaiImageResult, type OpenaiImageWire } from "./unified-image";
export {
  imageEdit,
  type OpenaiImageEditResult,
  type OpenaiImageEditWire,
} from "./unified-image-edit";
export { video, type OpenaiVideoResult, type OpenaiVideoWire } from "./unified-video";
export { stt, type OpenaiSttResult, type OpenaiSttWire } from "./unified-stt";
