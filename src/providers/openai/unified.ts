/**
 * OpenAI's unified adapters, one per category: `speech` (POST
 * /v1/audio/speech), `image` (POST /v1/images/generations) and `video` (POST
 * /v1/videos — Sora 2).
 *
 * A barrel over three modules rather than one file with three exports, because
 * `unmodel/speech`, `unmodel/image` and `unmodel/video` all reach this provider
 * and none should pay for the others' catalogs. Import this subpath to get all
 * three; the ready-made packs import the halves directly.
 */
export { speech, type OpenaiSpeechResult, type OpenaiSpeechWire } from "./unified-speech";
export { image, type OpenaiImageResult, type OpenaiImageWire } from "./unified-image";
export { video, type OpenaiVideoResult, type OpenaiVideoWire } from "./unified-video";
