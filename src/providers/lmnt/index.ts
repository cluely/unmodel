export {
  tts,
  ttsDetailed,
  SPEECH_BYTES_URL,
  SPEECH_URL,
  LMNT_VERSION,
  LMNT_VERSIONING_DOCS,
  SPEECH_FORMATS,
  STREAMABLE_FORMATS,
  NON_STREAMABLE_FORMATS,
  SPEECH_SAMPLE_RATES,
  SPEECH_LANGUAGES,
} from "./tts";
export type {
  SpeechBody,
  SpeechDetailedBody,
  LmntFormat,
  LmntLanguage,
  LmntSampleRate,
} from "./tts";

export {
  voiceClone,
  voiceCloneToFormData,
  AI_VOICE_URL,
  VOICE_CLONE_LMNT_VERSION,
  VOICE_CLONE_MODEL_ID,
} from "./voice-clone";
export type { AiVoiceParams } from "./voice-clone";

// No response checker: /v1/ai/speech/bytes streams raw audio, and the JSON
// /v1/ai/speech response carries no usage or billing field.

export { models, provider, TTS_MODEL_IDS, LMNT_MAX_CHARACTERS } from "./models";
export type { LmntModelId, LmntTtsModelId, LmntVoiceCloneModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
