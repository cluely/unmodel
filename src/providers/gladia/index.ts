export {
  stt,
  toUploadFormData,
  PRE_RECORDED_URL,
  UPLOAD_URL,
  MAX_AUDIO_DURATION_SECONDS,
  MAX_AUDIO_BYTES,
} from "./stt";
export type {
  PreRecordedBody,
  GladiaUploadParams,
  GladiaLanguageConfig,
  GladiaCustomVocabularyConfig,
  GladiaCustomVocabularyEntry,
  GladiaCallbackConfig,
  GladiaSubtitlesConfig,
  GladiaDiarizationConfig,
  GladiaTranslationConfig,
  GladiaSummarizationConfig,
  GladiaCustomSpellingConfig,
  GladiaAudioToLlmConfig,
  GladiaPiiRedactionConfig,
} from "./stt";

export { checkPreRecorded } from "./check";
export type { GladiaJobStatus, PreRecordedResultLike } from "./check";

export {
  models,
  provider,
  MODEL_IDS,
  DEFAULT_MODEL,
  SOLARIA_3_LANGUAGES,
  REALTIME_USD_PER_MINUTE,
} from "./models";
export type { GladiaModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
