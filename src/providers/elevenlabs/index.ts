export {
  speech,
  textToSpeechUrl,
  TEXT_TO_SPEECH_BASE_URL,
  DEFAULT_TTS_MODEL_ID,
  TTS_OUTPUT_FORMATS,
  TTS_OPTIMIZE_STREAMING_LATENCY_LEVELS,
  TTS_SPEED_MIN,
  TTS_SPEED_MAX,
} from "./speech";
export type {
  TextToSpeechParams,
  TextToSpeechQuery,
  TextToSpeechSdkParams,
  TextToSpeechSdkRequest,
  TextToSpeechSdkVoiceSettings,
  ElevenlabsVoiceSettings,
  ElevenlabsPronunciationDictionaryLocator,
  ElevenlabsOutputFormat,
  ElevenlabsOptimizeStreamingLatency,
} from "./speech";

export {
  textToSpeechStreamInput,
  textToSpeechStreamInputUrl,
  toInitializeConnectionMessage,
  STREAM_INPUT_WS_BASE_URL,
  STREAM_INPUT_CHUNK_LENGTH_MIN,
  STREAM_INPUT_CHUNK_LENGTH_MAX,
  STREAM_INPUT_DEFAULT_CHUNK_LENGTH_SCHEDULE,
  STREAM_INPUT_INACTIVITY_TIMEOUT_DEFAULT,
  STREAM_INPUT_INACTIVITY_TIMEOUT_MAX,
} from "./text-to-speech-stream-input";
export type {
  TextToSpeechStreamInputParams,
  TextToSpeechStreamInputQuery,
  InitializeConnectionMessage,
  StreamInputVoiceSettings,
  StreamInputGenerationConfig,
  StreamInputPronunciationDictionaryLocator,
} from "./text-to-speech-stream-input";

export {
  speechToTextRealtime,
  speechToTextRealtimeUrl,
  SPEECH_TO_TEXT_REALTIME_WS_URL,
  REALTIME_STT_AUDIO_FORMATS,
  REALTIME_STT_ENTITY_CATEGORIES,
  REALTIME_STT_KEYTERM_MAX_CHARACTERS,
  REALTIME_STT_KEYTERMS_MAX,
} from "./speech-to-text-realtime";
export type {
  SpeechToTextRealtimeParams,
  ElevenlabsRealtimeAudioFormat,
  ElevenlabsRealtimeEntityCategory,
  ElevenlabsRealtimeEntitySelector,
  ElevenlabsCommitStrategy,
} from "./speech-to-text-realtime";

export {
  speechToText,
  toFormData,
  speechToTextUrl,
  SPEECH_TO_TEXT_URL,
  STT_KEYTERM_MAX_CHARACTERS,
  STT_KEYTERM_MAX_WORDS,
  STT_KEYTERMS_MAX,
  STT_MAX_FILE_BYTES,
} from "./speech-to-text";
export type { SpeechToTextParams, SpeechToTextSdkParams } from "./speech-to-text";

export {
  music,
  musicUrl,
  requestedDurationMs,
  MUSIC_URL,
  DEFAULT_MUSIC_MODEL_ID,
  MUSIC_OUTPUT_FORMATS,
  MUSIC_LENGTH_MS_MIN,
  MUSIC_LENGTH_MS_MAX,
  MUSIC_SECTION_MS_MIN,
  MUSIC_SECTION_MS_MAX,
  MUSIC_MAX_SECTIONS,
  MUSIC_MAX_LINES_PER_SECTION,
  MUSIC_MAX_STYLES,
  MUSIC_PROMPT_MAX_CHARACTERS,
} from "./music";
export type {
  MusicParams,
  MusicSdkParams,
  ElevenlabsCompositionPlan,
  ElevenlabsMusicSectionsPlan,
  ElevenlabsMusicChunksPlan,
  ElevenlabsMusicSection,
  ElevenlabsMusicChunk,
  ElevenlabsMusicAudioRef,
  ElevenlabsMusicSectionSource,
  ElevenlabsMusicTimeRange,
  ElevenlabsMusicOutputFormat,
} from "./music";

// No TTS checker: /v1/text-to-speech responds with raw audio bytes, not JSON.
// Likewise /v1/music, which returns the track's bytes.
export { checkTranscription } from "./check";
export type { ElevenlabsTranscriptionLike, ElevenlabsTranscriptLike } from "./check";

export { speechConstraints, speechToTextConstraints } from "./constraints";

export {
  models,
  provider,
  TTS_MODEL_IDS,
  STT_MODEL_IDS,
  REALTIME_STT_MODEL_IDS,
  MUSIC_MODEL_IDS,
  MUSIC_PER_AUDIO_MINUTE,
} from "./models";
export type {
  ElevenlabsModelId,
  ElevenlabsTtsModelId,
  ElevenlabsSttModelId,
  ElevenlabsRealtimeSttModelId,
  ElevenlabsMusicModelId,
} from "./models";
