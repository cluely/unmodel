export {
  tts,
  ttsStream,
  SPEECH_GENERATE_URL,
  SPEECH_STREAM_URL,
  SPEECH_STREAM_GLOBAL_URL,
  DEFAULT_STREAM_MODEL,
  DEFAULT_MODEL_VERSION,
  SPEECH_FORMATS,
  CHANNEL_TYPES,
  GENERATE_SAMPLE_RATES,
  STREAM_SAMPLE_RATES,
  COMPANDED_FORMATS,
  COMPANDED_SAMPLE_RATE,
  COMPANDED_CHANNEL_TYPE,
  RATE_MIN,
  RATE_MAX,
  PITCH_MIN,
  PITCH_MAX,
  VARIATION_MIN,
  VARIATION_MAX,
} from "./tts";
export type {
  SpeechGenerateBody,
  SpeechStreamBody,
  MurfChannelType,
  MurfFormat,
  MurfGenerateSampleRate,
  MurfStreamSampleRate,
} from "./tts";

// Only /v1/speech/generate has a checker — /v1/speech/stream returns audio bytes.
export { checkTts } from "./check";
export type { MurfSpeechResponseLike, MurfWordDuration } from "./check";

export {
  models,
  provider,
  MURF_MAX_CHARACTERS,
  STREAM_MODEL_IDS,
  GENERATE_MODEL_IDS,
  GENERATE_MODEL_VERSIONS,
} from "./models";
export type { MurfModelId, MurfTtsModelId } from "./models";
