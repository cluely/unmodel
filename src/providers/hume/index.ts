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

export { models, provider, HUME_MODEL_IDS } from "./models";
export type { HumeModelId, HumeTtsModelId } from "./models";
