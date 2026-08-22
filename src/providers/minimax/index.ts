// unmodel/minimax — MiniMax (minimax.io) chat over the OpenAI-compatible
// dialect (POST https://api.minimax.io/v1/chat/completions — see ./chat, a
// dedicated leaf so `unmodel/chat` never walks this barrel), plus the speech,
// video and voice-creation validators. This is the international platform
// (the China platform is the separate minimax-cn catalog).

import { chatUrl } from "./chat";
import { models, provider } from "../../catalog/minimax.gen";

export { models, provider };
export type {
  MinimaxModelId,
  MinimaxTextModelId,
  MinimaxImageModelId,
  MinimaxAudioModelId,
  MinimaxVideoModelId,
} from "../../catalog/minimax.gen";

/** POST target for chat: {baseUrl}/chat/completions. */
export const CHAT_COMPLETIONS_URL = chatUrl;
export { chat, checkChat, estimateChatTokens } from "./chat";

// --- Speech (T2A v2) -------------------------------------------------------
export {
  tts,
  T2A_URL,
  T2A_UW_URL,
  T2A_EMOTIONS,
  T2A_AUDIO_FORMATS,
  T2A_SAMPLE_RATES,
  T2A_BITRATES,
  T2A_LANGUAGE_BOOSTS,
  T2A_SOUND_EFFECTS,
  T2A_MAX_TIMBRE_WEIGHTS,
} from "./tts";
export type {
  T2aParams,
  MinimaxVoiceSetting,
  MinimaxAudioSetting,
  MinimaxTimbreWeight,
  MinimaxVoiceModify,
  MinimaxEmotion,
  MinimaxAudioFormat,
  MinimaxLanguageBoost,
} from "./tts";

// --- Video (v1 Hailuo / 01 routes) ----------------------------------------
export {
  video,
  videoQueryUrl,
  videoPriceUSD,
  VIDEO_GENERATION_URL,
  VIDEO_QUERY_URL,
  VIDEO_RESOLUTIONS,
  VIDEO_MODEL_RULES,
  VIDEO_PRICE_USD,
  VIDEO_PROMPT_MAX_CHARACTERS,
  DEFAULT_VIDEO_DURATION,
} from "./video";
export type {
  VideoGenerationParams,
  MinimaxSubjectReference,
  MinimaxVideoResolution,
} from "./video";

// --- Video V2 (MiniMax-H3) ------------------------------------------------
export {
  videoV2,
  videoV2QueryUrl,
  VIDEO_GENERATION_V2_URL,
  VIDEO_V2_QUERY_URL,
  VIDEO_V2_MODEL_IDS,
  VIDEO_V2_RESOLUTIONS,
  VIDEO_V2_DURATIONS,
  VIDEO_V2_RATIOS,
  VIDEO_V2_CONTENT_TYPES,
  VIDEO_V2_ROLES,
  VIDEO_V2_TEXT_MAX_CHARACTERS,
  VIDEO_V2_MAX_REFERENCE_IMAGES,
  VIDEO_V2_MAX_REFERENCE_VIDEOS,
  VIDEO_V2_MAX_REFERENCE_AUDIO,
  VIDEO_V2_USD_PER_SECOND,
  VIDEO_V2_FREE_IMAGES,
  VIDEO_V2_USD_PER_EXTRA_IMAGE,
} from "./video-v2";
export type {
  VideoGenerationV2Params,
  MinimaxV2ContentItem,
  MinimaxV2ContentType,
  MinimaxV2Role,
  MinimaxMediaUrl,
  MinimaxVideoV2Resolution,
  MinimaxVideoV2Duration,
  MinimaxVideoV2Ratio,
} from "./video-v2";

// --- Voice creation (clone + design) ---------------------------------------
export {
  voiceClone,
  toVoiceUploadFormData,
  VOICE_CLONE_URL,
  FILE_UPLOAD_URL,
  VOICE_CLONE_MODEL_ID,
  VOICE_CLONE_TEXT_MAX_CHARACTERS,
  VOICE_CLONE_TEXT_VALIDATION_MAX_CHARACTERS,
  VOICE_CLONE_VOICE_ID_PATTERN,
} from "./voice-clone";
export type {
  VoiceCloneParams,
  MinimaxClonePrompt,
  MinimaxVoiceUpload,
  MinimaxVoiceUploadPurpose,
} from "./voice-clone";

export {
  voiceDesign,
  VOICE_DESIGN_URL,
  VOICE_DESIGN_MODEL_ID,
  VOICE_DESIGN_PREVIEW_TEXT_MAX_CHARACTERS,
} from "./voice-design";
export type { VoiceDesignParams } from "./voice-design";

// Hand-maintained speech + video catalog (the generated `models` above is the
// TEXT catalog; models.dev carries no MiniMax media models).
export {
  models as mediaModels,
  speechModels,
  videoModels,
  videoV2Models,
  voiceModels,
  SPEECH_MODEL_IDS,
  VIDEO_MODEL_IDS,
  T2A_MAX_CHARACTERS,
  T2A_HD_PER_MILLION_CHARACTERS,
  T2A_TURBO_PER_MILLION_CHARACTERS,
  VOICE_DESIGN_PREVIEW_PER_MILLION_CHARACTERS,
} from "./models";
export type {
  MinimaxMediaModelId,
  MinimaxSpeechModelId,
  MinimaxVideoGenerationModelId,
  MinimaxVideoV2ModelId,
  MinimaxVoiceModelId,
} from "./models";

// Every media route returns either JSON audio (t2a) or an async task handle
// (video), and unmodel validates requests only — so no response checkers here.
