/**
 * ElevenLabs' unified adapters, one per category: `tts` (POST
 * /v1/text-to-speech/{voice_id}), `stt` (POST /v1/speech-to-text) and
 * `music` (POST /v1/music).
 *
 * A barrel over three modules rather than one file with three exports, because
 * `unmodel/tts`, `unmodel/stt` and `unmodel/music` all reach this
 * provider and none should pay for the others' validators or catalogs. Import
 * this subpath to get all three; the ready-made packs import the halves
 * directly.
 */
export { tts, type ElevenlabsTtsResult, type ElevenlabsTtsWire } from "./unified-tts";
export {
  stt,
  type ElevenlabsSttResult,
  type ElevenlabsSttWire,
} from "./unified-stt";
export { music, type ElevenlabsMusicResult, type ElevenlabsMusicWire } from "./unified-music";
