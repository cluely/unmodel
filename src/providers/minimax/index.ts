// unmodel/minimax — MiniMax (minimax.io) chat over the OpenAI-compatible
// dialect: POST https://api.minimax.io/v1/chat/completions. Params mirror the
// wire format exactly; validation runs against the generated minimax catalog.
// This is the international platform (the China platform is the separate
// minimax-cn catalog).

import { createOpenAICompatible } from "../openai-compatible";
import { models, provider } from "../../catalog/minimax.gen";
import type { MinimaxTextModelId } from "../../catalog/minimax.gen";
import { availability } from "../../catalog/availability/minimax.gen";

const { chat, chatUrl, checkChat, estimateChatTokens } =
  createOpenAICompatible<MinimaxTextModelId, typeof availability>({
    id: "minimax",
    // NOT provider.api: the models.dev snapshot records MiniMax's
    // Anthropic-compatible route (https://api.minimax.io/anthropic/v1). The
    // OpenAI-compatible base is https://api.minimax.io/v1, per
    // https://platform.minimax.io/docs/api-reference/text-openai-api
    baseUrl: "https://api.minimax.io/v1",
    catalog: models,
    availability,
  });

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
export { chat, checkChat, estimateChatTokens };

// --- Speech (T2A v2) -------------------------------------------------------
export {
  speech,
  T2A_URL,
  T2A_UW_URL,
  T2A_EMOTIONS,
  T2A_AUDIO_FORMATS,
  T2A_SAMPLE_RATES,
  T2A_BITRATES,
  T2A_LANGUAGE_BOOSTS,
  T2A_SOUND_EFFECTS,
  T2A_MAX_TIMBRE_WEIGHTS,
} from "./speech";
export type {
  T2aParams,
  MinimaxVoiceSetting,
  MinimaxAudioSetting,
  MinimaxTimbreWeight,
  MinimaxVoiceModify,
  MinimaxEmotion,
  MinimaxAudioFormat,
  MinimaxLanguageBoost,
} from "./speech";

// --- Video (v1 Hailuo / 01 routes) ----------------------------------------
export {
  videoGeneration,
  videoQueryUrl,
  videoPriceUSD,
  VIDEO_GENERATION_URL,
  VIDEO_QUERY_URL,
  VIDEO_RESOLUTIONS,
  VIDEO_MODEL_RULES,
  VIDEO_PRICE_USD,
  VIDEO_PROMPT_MAX_CHARACTERS,
  DEFAULT_VIDEO_DURATION,
} from "./video-generation";
export type {
  VideoGenerationParams,
  MinimaxSubjectReference,
  MinimaxVideoResolution,
} from "./video-generation";

// --- Video V2 (MiniMax-H3) ------------------------------------------------
export {
  videoGenerationV2,
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
} from "./video-generation-v2";
export type {
  VideoGenerationV2Params,
  MinimaxV2ContentItem,
  MinimaxMediaUrl,
  MinimaxVideoV2Resolution,
  MinimaxVideoV2Duration,
  MinimaxVideoV2Ratio,
} from "./video-generation-v2";

// Hand-maintained speech + video catalog (the generated `models` above is the
// TEXT catalog; models.dev carries no MiniMax media models).
export {
  models as mediaModels,
  speechModels,
  videoModels,
  videoV2Models,
  SPEECH_MODEL_IDS,
  VIDEO_MODEL_IDS,
  T2A_MAX_CHARACTERS,
  T2A_HD_PER_MILLION_CHARACTERS,
  T2A_TURBO_PER_MILLION_CHARACTERS,
} from "./models";
export type {
  MinimaxMediaModelId,
  MinimaxSpeechModelId,
  MinimaxVideoGenerationModelId,
  MinimaxVideoV2ModelId,
} from "./models";

// Every media route returns either JSON audio (t2a) or an async task handle
// (video), and unmodel validates requests only — so no response checkers here.
