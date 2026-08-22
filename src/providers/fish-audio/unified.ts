/**
 * Fish Audio's unified adapters, one per category: `tts` (POST /v1/tts),
 * `voiceClone` (POST /model) and `voiceDesign` (POST /v1/voice-design).
 *
 * A barrel over three modules rather than one file with three exports,
 * because every ready-made pack reaches this provider and none should pay for
 * the others' validators. Import this subpath to get all three; the
 * ready-made packs import the leaves directly.
 */
export { tts, type FishAudioTtsResult, type FishAudioTtsWire } from "./unified-tts";
// The voice-creation adapters live in their own leaves so `unmodel/tts` never
// pays for them; this subpath re-exports the full set.
export {
  voiceClone,
  type FishAudioVoiceCloneResult,
  type FishAudioVoiceCloneWire,
} from "./unified-voice-clone";
export {
  voiceDesign,
  type FishAudioVoiceDesignResult,
  type FishAudioVoiceDesignWire,
} from "./unified-voice-design";
