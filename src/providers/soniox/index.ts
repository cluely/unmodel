export {
  stt,
  toUploadFormData,
  TRANSCRIPTIONS_URL,
  FILES_URL,
  MAX_AUDIO_DURATION_SECONDS,
} from "./stt";
export type {
  TranscriptionsBody,
  SonioxTranslation,
  SonioxTranslationOneWay,
  SonioxTranslationTwoWay,
  SonioxContextObject,
  SonioxFileUploadParams,
} from "./stt";

export {
  realtimeTranscription,
  REALTIME_URL,
  SONIOX_CONTAINER_AUDIO_FORMATS,
  SONIOX_RAW_AUDIO_FORMATS,
  MAX_ENDPOINT_DELAY_MS_MIN,
  MAX_ENDPOINT_DELAY_MS_MAX,
  ENDPOINT_SENSITIVITY_MIN,
  ENDPOINT_SENSITIVITY_MAX,
  ENDPOINT_LATENCY_ADJUSTMENT_LEVEL_MIN,
  ENDPOINT_LATENCY_ADJUSTMENT_LEVEL_MAX,
  MAX_CONTEXT_CHARACTERS,
  MAX_CLIENT_REFERENCE_ID_CHARACTERS,
  contextLength,
} from "./realtime";
export type {
  RealtimeTranscriptionConfig,
  SonioxAudioFormat,
  SonioxContainerAudioFormat,
  SonioxRawAudioFormat,
} from "./realtime";

export { checkTranscription } from "./check";
export type { SonioxTranscriptionStatus, TranscriptionResponseLike } from "./check";

export { models, provider, ASYNC_MODEL_IDS, REALTIME_MODEL_IDS } from "./models";
export type { SonioxModelId, SonioxAsyncModelId, SonioxRealtimeModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
