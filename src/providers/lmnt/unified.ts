/**
 * LMNT's unified adapters: `tts` (POST /v1/ai/speech/bytes) and `voiceClone`
 * (POST /v1/ai/voice).
 *
 * A barrel over two modules rather than one file with two exports, because
 * `unmodel/tts` and `unmodel/voice-clone` both reach this provider and
 * neither should pay for the other's validator. Import this subpath to get
 * both; the ready-made packs import the leaves directly.
 */
export { tts, type LmntTtsResult, type LmntTtsWire } from "./unified-tts";
// The voice-clone adapter lives in its own leaf so `unmodel/tts` never pays
// for it; this subpath re-exports the pair.
export {
  voiceClone,
  type LmntVoiceCloneResult,
  type LmntVoiceCloneWire,
} from "./unified-voice-clone";
