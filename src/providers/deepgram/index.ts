export {
  stt,
  listenUrl,
  withQuery,
  LISTEN_URL,
  LISTEN_ENCODINGS,
  NOVA_3_MULTILINGUAL_USD_PER_MINUTE,
  REDACT_GROUPS,
} from "./stt";
export type { ListenParams, DeepgramRedact, DeepgramListenEncoding } from "./stt";

export {
  listenLive,
  listenLiveUrl,
  listenFlux,
  listenFluxUrl,
  fluxConfigure,
  speakLive,
  speakLiveUrl,
  LISTEN_LIVE_URL,
  LISTEN_FLUX_URL,
  SPEAK_LIVE_URL,
  LISTEN_LIVE_ENCODINGS,
  LISTEN_LIVE_CALLBACK_METHODS,
  LISTEN_LIVE_DIARIZE_MODELS,
  UTTERANCE_END_MIN_MS,
  NOVA_3_STREAMING_USD_PER_MINUTE,
  NOVA_3_MULTILINGUAL_STREAMING_USD_PER_MINUTE,
  FLUX_MODEL_IDS,
  FLUX_ENCODINGS,
  FLUX_REDACT_VALUES,
  FLUX_KEYTERMS_MAX,
  EOT_THRESHOLD_MIN,
  EOT_THRESHOLD_MAX,
  EOT_THRESHOLD_DEFAULT,
  EAGER_EOT_THRESHOLD_MIN,
  EAGER_EOT_THRESHOLD_MAX,
  EOT_TIMEOUT_MS_MIN,
  EOT_TIMEOUT_MS_MAX,
  SPEAK_LIVE_ENCODINGS,
  SPEAK_LIVE_SAMPLE_RATES,
  DEFAULT_SPEAK_LIVE_ENCODING,
  DEFAULT_SPEAK_LIVE_MODEL_ID,
} from "./realtime";
export type {
  ListenLiveParams,
  ListenFluxParams,
  FluxConfigureMessage,
  FluxConfigureThresholds,
  SpeakLiveParams,
  DeepgramLiveEncoding,
  DeepgramLiveCallbackMethod,
  DeepgramLiveDiarizeModel,
  DeepgramFluxModelId,
  DeepgramFluxEncoding,
  DeepgramFluxRedact,
  DeepgramSpeakLiveEncoding,
  DeepgramSpeakLiveSampleRate,
} from "./realtime";

export {
  tts,
  speakUrl,
  SPEAK_URL,
  DEFAULT_SPEAK_MODEL_ID,
  SPEAK_ENCODINGS,
  SPEAK_CONTAINERS,
  DEEPGRAM_SPEAK_SAMPLE_RATES,
  SPEAK_SPEED_MIN,
  SPEAK_SPEED_MAX,
  AUDIO_FORMATS,
} from "./tts";
export type {
  SpeakParams,
  DeepgramSpeakEncoding,
  DeepgramSpeakContainer,
  DeepgramSpeakSampleRate,
} from "./tts";

export { checkListen } from "./check";
export type { ListenResponseLike } from "./check";
// No TTS checker: POST /v1/speak responds with raw audio bytes, not JSON.

export {
  models,
  sttModels,
  ttsModels,
  provider,
  NOVA_3_USD_PER_MINUTE,
  AURA_1_USD_PER_MILLION_CHARACTERS,
  AURA_2_USD_PER_MILLION_CHARACTERS,
  SPEAK_MAX_CHARACTERS,
  TTS_MODEL_IDS,
} from "./models";
export type { DeepgramModelId, DeepgramSttModelId, DeepgramTtsModelId } from "./models";
