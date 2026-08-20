/**
 * Cartesia's unified adapters, one per category: `speech` (POST /tts/bytes)
 * and `transcribe` (POST /stt).
 *
 * A barrel over two modules rather than one file with two exports, because
 * `unmodel/speech` and `unmodel/transcribe` both reach this provider and
 * neither should pay for the other's validator or catalog. Import this subpath
 * to get both; the ready-made packs import the halves directly.
 */
export { speech, type CartesiaSpeechResult, type CartesiaSpeechWire } from "./unified-speech";
export {
  transcribe,
  type CartesiaTranscribeResult,
  type CartesiaTranscribeWire,
} from "./unified-transcribe";
