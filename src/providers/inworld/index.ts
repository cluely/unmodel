export {
  tts,
  ttsConstraints,
  audioConfigSchema,
  TTS_VOICE_URL,
  TTS_VOICE_STREAM_URL,
  INWORLD_TTS_MAX_CHARACTERS,
  INWORLD_SAMPLE_RATES_HERTZ,
} from "./tts";
export type {
  TtsVoiceBody,
  InworldAudioConfig,
  InworldAudioEncoding,
  InworldSampleRateHertz,
  InworldDeliveryMode,
  InworldTimestampType,
  InworldApplyTextNormalization,
  InworldSynthesisContext,
} from "./tts";

export {
  stt,
  checkTranscribeConfig,
  decodedBase64Bytes,
  sttVendorOf,
  streamOnlyConfigShape,
  transcribeConfigShape,
  INWORLD_STT_AUDIO_ENCODINGS,
  INWORLD_STT_STREAM_UNSUPPORTED_ENCODINGS,
  LINEAR16_BYTES_PER_SAMPLE,
  STT_DEFAULT_CHANNELS,
  STT_DEFAULT_SAMPLE_RATE_HERTZ,
  STT_MAX_AUDIO_BYTES,
  STT_OVERVIEW_DOCS,
  STT_TRANSCRIBE_URL,
  TRANSCRIBE_DOCS,
} from "./stt";
export type {
  TranscribeBody,
  TranscribeConfigCheckOptions,
  InworldAssemblyaiConfig,
  InworldAudioContent,
  InworldGroqConfig,
  InworldRealtimeTranscribeConfig,
  InworldSonioxConfig,
  InworldSonioxContext,
  InworldSttAudioEncoding,
  InworldSttV1Config,
  InworldTranscribeConfig,
  InworldVoiceProfileConfig,
} from "./stt";

export {
  realtimeTranscribeConfig,
  realtimeVoiceContext,
  STT_STREAM_WS_URL,
  STT_WEBSOCKET_DOCS,
  TTS_STREAM_WS_URL,
  TTS_WEBSOCKET_DOCS,
  TTS_STREAM_IDLE_TIMEOUT_MINUTES,
  TTS_STREAM_MAX_BUFFER_CHAR_THRESHOLD,
  TTS_STREAM_MAX_CONNECTIONS,
  TTS_STREAM_MAX_CONTEXTS_PER_CONNECTION,
  TTS_STREAM_MAX_TEXT_CHARACTERS,
} from "./realtime";
export type {
  InworldTimestampTransportStrategy,
  InworldVoiceContextConfig,
  RealtimeTranscribeFrame,
  RealtimeVoiceContextFrame,
} from "./realtime";

export {
  voiceClone,
  checkLanguageExclusivity,
  checkLangCodeEnum,
  VOICES_CLONE_URL,
  VOICE_CLONE_MODEL_ID,
  VOICE_CLONE_MAX_SAMPLE_BYTES,
  INWORLD_LANG_CODES,
} from "./voice-clone";
export type {
  VoicesCloneBody,
  InworldVoiceSample,
  InworldAudioProcessingConfig,
  InworldLangCode,
} from "./voice-clone";

export {
  voiceDesign,
  VOICES_DESIGN_URL,
  VOICE_DESIGN_MODEL_ID,
  VOICE_DESIGN_PROMPT_MIN_CHARACTERS,
  VOICE_DESIGN_PROMPT_MAX_CHARACTERS,
  VOICE_DESIGN_SAMPLES_MIN,
  VOICE_DESIGN_SAMPLES_MAX,
} from "./voice-design";
export type { VoicesDesignBody, InworldVoiceDesignConfig } from "./voice-design";

export {
  voiceDesignPublish,
  voiceDesignPublishUrl,
  VOICES_PUBLISH_BASE_URL,
} from "./voice-design-publish";
export type { VoicesPublishBody } from "./voice-design-publish";

export {
  models,
  provider,
  sttModels,
  ttsModels,
  STT_1_USD_PER_MINUTE,
  STT_STREAM_MODEL_IDS,
  STT_SYNC_MODEL_IDS,
} from "./models";
export type {
  InworldModelId,
  InworldSttModelId,
  InworldSttVendor,
  InworldTtsModelId,
  InworldVoiceModelId,
} from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
