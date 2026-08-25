// unmodel/alibaba — Alibaba Model Studio (Qwen model family) chat over the
// OpenAI-compatible dialect (POST
// https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions —
// see ./chat, a dedicated leaf so `unmodel/chat` never walks this barrel),
// plus the DashScope video-synthesis (Wan + HappyHorse) and Qwen-TTS
// validators. This is DashScope's international platform (the China endpoint
// is the separate alibaba-cn catalog).

import { chatUrl } from "./chat";
import { models, provider } from "../../catalog/alibaba.gen";

export { models, provider };
export type {
  AlibabaModelId,
  AlibabaTextModelId,
  AlibabaImageModelId,
  AlibabaAudioModelId,
  AlibabaVideoModelId,
} from "../../catalog/alibaba.gen";

/** POST target for chat: {baseUrl}/chat/completions. */
export const CHAT_COMPLETIONS_URL = chatUrl;
export { chat, checkChat, estimateChatTokens } from "./chat";

// --- Video (Wan + HappyHorse, DashScope video-synthesis) -------------------
export {
  video,
  videoSynthesisUrl,
  videoTaskUrl,
  videoPriceUSD,
  videoBillingTier,
  DEFAULT_BASE_URL,
  VIDEO_SYNTHESIS_PATH,
  VIDEO_SYNTHESIS_URL,
  VIDEO_HEADERS,
  VIDEO_RESOLUTIONS,
  VIDEO_MEDIA_TYPES,
  VIDEO_MODEL_RULES,
  VIDEO_PRICE_PER_SECOND_USD,
  SIZES_480P,
  SIZES_720P,
  SIZES_1080P,
  SIZE_TIER,
  NEGATIVE_PROMPT_MAX_CHARACTERS,
  DEFAULT_VIDEO_DURATION,
  WAN3_DURATIONS,
  WAN27_DURATIONS,
  HAPPYHORSE_DURATIONS,
} from "./video";
export type {
  VideoSynthesisParams,
  AlibabaVideoInput,
  AlibabaVideoParameters,
  AlibabaVideoMedia,
  AlibabaVideoMediaType,
  AlibabaVideoResolution,
  AlibabaVideoModelRule,
} from "./video";

// --- Speech (Qwen3 TTS, DashScope multimodal-generation) -------------------
export {
  tts,
  ttsUrl,
  TTS_PATH,
  TTS_URL,
  REALTIME_TTS_WSS_URL,
  INSTRUCTIONS_MAX_TOKENS,
  LANGUAGE_TYPES,
} from "./tts";
export type { TtsGenerationParams, AlibabaTtsInput, AlibabaLanguageType } from "./tts";

// Hand-maintained video + speech catalog (the generated `models` above is the
// TEXT catalog; models.dev carries none of the wan/happyhorse/qwen3-tts ids).
export {
  models as mediaModels,
  videoModels,
  ttsModels,
  realtimeTtsModels,
  VIDEO_MODEL_IDS,
  TTS_MODEL_IDS,
  REALTIME_TTS_MODEL_IDS,
  TTS_MAX_CHARACTERS,
  TTS_FLASH_PER_MILLION_CHARACTERS,
  TTS_INSTRUCT_PER_MILLION_CHARACTERS,
  QWEN3_TTS_FLASH_VOICES,
  QWEN3_TTS_FLASH_2025_09_18_VOICES,
  QWEN3_TTS_INSTRUCT_FLASH_VOICES,
  VOICES_BY_MODEL,
} from "./models";
export type {
  AlibabaMediaModelId,
  AlibabaVideoGenerationModelId,
  AlibabaTtsGenerationModelId,
  AlibabaRealtimeTtsModelId,
} from "./models";

// Every media route returns JSON — an async task handle (video) or an audio
// URL (tts) — and unmodel validates requests only, so no response checkers.
