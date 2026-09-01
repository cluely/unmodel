export {
  tts,
  TTS_URL,
  TTS_FILE_URL,
  TTS_STREAM_JSON_URL,
  TTS_STREAM_FILE_URL,
  TTS_STREAM_INPUT_URL,
  MAX_TEXT_CHARACTERS,
  MAX_DESCRIPTION_CHARACTERS,
  MAX_GENERATIONS,
  OCTAVE_VERSIONS,
} from "./tts";
export type {
  TtsBody,
  TtsSdkParams,
  TtsSdkUtterance,
  HumeUtterance,
  HumeVoiceRef,
  HumeVoiceProvider,
  HumeContext,
  HumeFormat,
  HumeAudioFormatType,
  HumeTimestampType,
  HumeOctaveVersion,
} from "./tts";

export {
  sts,
  stsToFormData,
  VOICE_CONVERSION_URL,
  VOICE_CONVERSION_JSON_URL,
  STS_MODEL_ID,
} from "./sts";
export type { VoiceConversionBody, VoiceConversionSdkParams } from "./sts";

export { models, provider, HUME_MODEL_IDS } from "./models";
export type { HumeModelId, HumeTtsModelId, HumeStsModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
