/**
 * ElevenLabs' unified adapters, one per category: `speech` (POST
 * /v1/text-to-speech/{voice_id}), `transcribe` (POST /v1/speech-to-text) and
 * `music` (POST /v1/music).
 *
 * A barrel over three modules rather than one file with three exports, because
 * `unmodel/speech`, `unmodel/transcribe` and `unmodel/music` all reach this
 * provider and none should pay for the others' validators or catalogs. Import
 * this subpath to get all three; the ready-made packs import the halves
 * directly.
 */
export { speech, type ElevenlabsSpeechResult, type ElevenlabsSpeechWire } from "./unified-speech";
export {
  transcribe,
  type ElevenlabsTranscribeResult,
  type ElevenlabsTranscribeWire,
} from "./unified-transcribe";
export { music, type ElevenlabsMusicResult, type ElevenlabsMusicWire } from "./unified-music";
