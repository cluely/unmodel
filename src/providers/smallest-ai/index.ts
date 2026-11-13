export {
  tts,
  ttsConstraints,
  TTS_URL,
  TTS_LIVE_URL,
  TTS_LIVE_WS_URL,
  MAX_CHARACTERS,
  SAMPLE_RATES,
  OUTPUT_FORMATS,
  LANGUAGES,
  PRO_ONLY_LANGUAGES,
  DATE_FORMATS,
  CONTENT_FILTER_ACTIONS,
} from "./tts";
export type {
  TtsBody,
  TtsParams,
  SmallestSampleRate,
  SmallestOutputFormat,
  SmallestLanguage,
  SmallestDateFormat,
  SmallestContentFilter,
  SmallestContentFilterAction,
} from "./tts";

export { models, provider, SMALLEST_MODEL_IDS } from "./models";
export type { SmallestModelId, SmallestTtsModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
