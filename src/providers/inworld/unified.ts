/**
 * Inworld's unified adapters, one per category: `speech` (POST /tts/v1/voice)
 * and `transcribe` (POST /stt/v1/transcribe).
 *
 * A barrel over two modules rather than one file with two exports, because
 * `unmodel/speech` and `unmodel/transcribe` both reach this provider and
 * neither should pay for the other's validator or catalog. Import this subpath
 * to get both; the ready-made packs import the halves directly.
 *
 * The transcribe half declares `audio` unsupported — its route takes base64
 * inline and a synchronous compile step cannot produce it. Its module header
 * is where that decision is argued.
 */
export { speech, type InworldSpeechResult, type InworldSpeechWire } from "./unified-speech";
export {
  transcribe,
  type InworldTranscribeResult,
  type InworldTranscribeWire,
} from "./unified-transcribe";
