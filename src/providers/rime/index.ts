export {
  tts,
  ttsConstraints,
  RIME_TTS_URL,
  RIME_WS_URL,
  DEFAULT_MODEL_ID,
  MAX_CHARACTERS,
  SAMPLING_RATE_FLOOR,
  SAMPLING_RATE_CEILING,
  TIME_SCALE_FACTOR_MIN,
  TIME_SCALE_FACTOR_MAX,
  ACCEPT_VALUES,
  DEPRECATED_ACCEPT_ALIASES,
  MIST_V2_ACCEPT_VALUES,
  LANGUAGES,
  MIST_LANGUAGES,
} from "./tts";
export type {
  RimeTtsBody,
  RimeTtsParams,
  RimeAccept,
  RimeDeprecatedAccept,
  RimeLanguage,
} from "./tts";

export { models, provider, RIME_MODEL_IDS, ARCANA_MODEL_IDS } from "./models";
export type { RimeModelId, RimeTtsModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
