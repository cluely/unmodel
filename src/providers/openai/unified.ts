/**
 * OpenAI's unified adapters, one per category: `speech` (POST
 * /v1/audio/speech) and `image` (POST /v1/images/generations).
 *
 * A barrel over two modules rather than one file with two exports, because
 * `unmodel/speech` and `unmodel/image` both reach this provider and neither
 * should pay for the other's catalog. Import this subpath to get both; the
 * ready-made packs import the halves directly.
 */
export { speech, type OpenaiSpeechResult, type OpenaiSpeechWire } from "./unified-speech";
export { image, type OpenaiImageResult, type OpenaiImageWire } from "./unified-image";
