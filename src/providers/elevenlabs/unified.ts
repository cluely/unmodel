/**
 * ElevenLabs' unified adapters, one per category: `tts` (POST
 * /v1/text-to-speech/{voice_id}), `stt` (POST /v1/speech-to-text), `music`
 * (POST /v1/music), `sfx` (POST /v1/sound-generation), `sts`
 * (POST /v1/speech-to-speech/{voice_id}), `voiceClone` (POST /v1/voices/add)
 * and `voiceDesign` (POST /v1/text-to-voice/design).
 *
 * A barrel over seven modules rather than one file with seven exports, because
 * every ready-made pack reaches this provider and none should pay for the
 * others' validators or catalogs. Import this subpath to get all seven; the
 * ready-made packs import the leaves directly.
 */
export { tts, type ElevenlabsTtsResult, type ElevenlabsTtsWire } from "./unified-tts";
export { stt, type ElevenlabsSttResult, type ElevenlabsSttWire } from "./unified-stt";
export { music, type ElevenlabsMusicResult, type ElevenlabsMusicWire } from "./unified-music";
export { sfx, type ElevenlabsSfxResult, type ElevenlabsSfxWire } from "./unified-sfx";
export { sts, type ElevenlabsStsResult, type ElevenlabsStsWire } from "./unified-sts";
export {
  voiceClone,
  type ElevenlabsVoiceCloneResult,
  type ElevenlabsVoiceCloneWire,
} from "./unified-voice-clone";
export {
  voiceDesign,
  type ElevenlabsVoiceDesignResult,
  type ElevenlabsVoiceDesignWire,
} from "./unified-voice-design";
