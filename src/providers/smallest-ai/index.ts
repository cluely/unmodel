export {
  speech,
  speechConstraints,
  TTS_URL,
  TTS_LIVE_URL,
  TTS_LIVE_WS_URL,
  DEFAULT_MODEL_ID,
  MAX_CHARACTERS,
  REQUIRED_ACCEPT,
  SAMPLE_RATES,
  OUTPUT_FORMATS,
  LANGUAGES,
  PRO_ONLY_LANGUAGES,
} from "./speech";
export type {
  TtsBody,
  TtsParams,
  SmallestSampleRate,
  SmallestOutputFormat,
  SmallestLanguage,
} from "./speech";

export { models, provider, SMALLEST_MODEL_IDS } from "./models";
export type { SmallestModelId, SmallestTtsModelId } from "./models";
