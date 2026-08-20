/**
 * OpenAI's unified adapters, one per category: `speech` (POST
 * /v1/audio/speech), `image` (POST /v1/images/generations), `video` (POST
 * /v1/videos — Sora 2) and `transcribe` (POST /v1/audio/transcriptions).
 *
 * A barrel over four modules rather than one file with four exports, because
 * `unmodel/speech`, `unmodel/image`, `unmodel/video` and `unmodel/transcribe`
 * all reach this provider and none should pay for the others' catalogs. Import
 * this subpath to get all four; the ready-made packs import the halves
 * directly.
 */
export { speech, type OpenaiSpeechResult, type OpenaiSpeechWire } from "./unified-speech";
export { image, type OpenaiImageResult, type OpenaiImageWire } from "./unified-image";
export { video, type OpenaiVideoResult, type OpenaiVideoWire } from "./unified-video";
export {
  transcribe,
  type OpenaiTranscribeResult,
  type OpenaiTranscribeWire,
} from "./unified-transcribe";
