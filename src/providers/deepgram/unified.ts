/**
 * Deepgram's unified adapters, one per category: `speech` (POST /v1/speak) and
 * `transcribe` (POST /v1/listen).
 *
 * A barrel over two modules rather than one file with two exports, because
 * `unmodel/speech` and `unmodel/transcribe` both reach this provider and
 * neither should pay for the other's validator or catalog. Import this subpath
 * to get both; the ready-made packs import the halves directly.
 */
export { speech, type DeepgramSpeechResult, type DeepgramSpeechWire } from "./unified-speech";
export {
  transcribe,
  type DeepgramTranscribeResult,
  type DeepgramTranscribeWire,
} from "./unified-transcribe";
