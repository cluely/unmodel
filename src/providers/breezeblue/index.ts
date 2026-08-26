export {
  tts,
  textToSpeechUrl,
  textToSpeechStreamUrl,
  TEXT_TO_SPEECH_BASE_URL,
  OUTPUT_FORMATS,
  STREAM_OUTPUT_FORMATS,
  DEFAULT_OUTPUT_FORMAT,
  DELIVERY_MODES,
  GUIDANCE_SCALE_MIN,
  GUIDANCE_SCALE_MAX,
  DEFAULT_GUIDANCE_SCALE,
  MODEL_ID_MAX_LENGTH,
} from "./tts";
export type {
  TtsBody,
  TtsParams,
  TtsQuery,
  BreezeblueVoiceSettings,
  BreezeblueOutputFormat,
  BreezeblueStreamOutputFormat,
  BreezeblueDelivery,
  BreezeblueSdkParams,
  BreezeblueSdkRequest,
  BreezeblueSdkOptions,
  BreezeblueSdkVoiceSettings,
} from "./tts";

export {
  models,
  provider,
  BREEZEBLUE_MODEL_IDS,
  VOICE_LANGUAGE_CODES,
  TTS_COST_PER_MILLION_CHARACTERS_USD,
} from "./models";
export type {
  BreezeblueModelId,
  BreezeblueTtsModelId,
  BreezeblueVoiceLanguageCode,
} from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
