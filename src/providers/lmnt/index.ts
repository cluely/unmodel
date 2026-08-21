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

// No response checker: /v1/ai/speech/bytes streams raw audio, and the JSON
// /v1/ai/speech response carries no usage or billing field.

export { models, provider, TTS_MODEL_IDS, LMNT_MAX_CHARACTERS } from "./models";
export type { LmntModelId, LmntTtsModelId } from "./models";
