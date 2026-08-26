export {
  stt,
  toFormData,
  jobsUrl,
  JOBS_URL,
  MAX_DATA_FILE_BYTES,
  DEFAULT_MODEL,
  SUPPORTED_FILE_TYPES,
  resolveModel,
} from "./stt";
export type {
  JobConfig,
  SpeechmaticsJobUpload,
  SpeechmaticsTranscriptionConfig,
  SpeechmaticsFetchConfig,
  SpeechmaticsAdditionalVocabEntry,
  SpeechmaticsPunctuationOverrides,
  SpeechmaticsAudioFilteringConfig,
  SpeechmaticsTranscriptFilteringConfig,
  SpeechmaticsReplacement,
  SpeechmaticsSpeaker,
  SpeechmaticsSpeakerDiarizationConfig,
  SpeechmaticsNotificationConfig,
  SpeechmaticsTracking,
  SpeechmaticsOutputConfig,
  SpeechmaticsTranslationConfig,
  SpeechmaticsLanguageIdentificationConfig,
  SpeechmaticsSummarizationConfig,
  SpeechmaticsTopicDetectionConfig,
  SpeechmaticsAudioEventsConfig,
} from "./stt";

export { checkJob } from "./check";
export type { JobDetailsLike, SpeechmaticsJobStatus } from "./check";

export {
  models,
  provider,
  MODEL_IDS,
  BATCH_HOSTS,
  MELIA_REGIONS,
  REALTIME_STANDARD_USD_PER_MINUTE,
  REALTIME_ENHANCED_USD_PER_MINUTE,
} from "./models";
export type { SpeechmaticsModelId, SpeechmaticsRegion } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
