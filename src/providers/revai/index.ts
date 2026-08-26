export {
  stt,
  toFormData,
  JOBS_URL,
  MAX_MEDIA_DURATION_SECONDS,
  TELUGU_MAX_MEDIA_DURATION_SECONDS,
  MAX_MEDIA_BYTES,
  MIN_SEGMENT_SECONDS,
  MAX_DELETE_AFTER_SECONDS,
} from "./stt";
export type {
  JobsBody,
  RevaiJobUpload,
  RevaiSourceConfig,
  RevaiNotificationConfig,
  RevaiAuthHeaders,
  RevaiSegment,
  RevaiSpeakerName,
  RevaiCustomVocabulary,
  RevaiSummarizationConfig,
  RevaiTranslationConfig,
  RevaiTranslationTarget,
} from "./stt";

export { checkJob } from "./check";
export type { JobResponseLike, RevaiJobStatus } from "./check";

export {
  models,
  provider,
  TRANSCRIBERS,
  DEFAULT_TRANSCRIBER,
  MINIMUM_BILLED_SECONDS,
  FOREIGN_LANGUAGE_USD_PER_MINUTE,
  HUMAN_RUSH_USD_PER_MINUTE,
  HUMAN_VERBATIM_USD_PER_MINUTE,
} from "./models";
export type { RevaiTranscriber } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
