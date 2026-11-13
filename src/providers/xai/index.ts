/**
 * unmodel/xai — xAI's OpenAI-compatible Chat Completions endpoint (Grok is
 * the model family: "grok-4.6", "grok-4.20-0309-reasoning", ...), plus the
 * Grok Imagine image and video validators. Chat is validated against the
 * generated models.dev catalog; the Imagine routes against the supplemented
 * catalog in ./models.
 */
import { chat, chatUrl, checkChat, estimateChatTokens, models, provider } from "./chat";

/** POST https://api.x.ai/v1/chat/completions */
const CHAT_COMPLETIONS_URL = chatUrl;

export { chat, checkChat, estimateChatTokens, CHAT_COMPLETIONS_URL, models, provider };
export type {
  XaiModelId,
  XaiTextModelId,
  XaiImageModelId,
  XaiAudioModelId,
  XaiVideoModelId,
} from "../../catalog/xai.gen";

// --- Image (Grok Imagine, POST /v1/images/generations) ---------------------
export {
  image,
  IMAGE_GENERATIONS_URL,
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  IMAGE_QUALITIES,
  IMAGE_RESPONSE_FORMATS,
  IMAGE_MAX_N,
} from "./image";
export type {
  ImageGenerationsParams,
  XaiImageAspectRatio,
  XaiImageResolution,
  XaiImageQuality,
  XaiImageResponseFormat,
  XaiStorageOptions,
  XaiPublicUrlOptions,
} from "./image";

// --- Video (Grok Imagine, POST /v1/videos/*) --------------------------------
export {
  video,
  videoEdit,
  videoExtend,
  videoStatusUrl,
  videoPriceUSD,
  VIDEO_GENERATIONS_URL,
  VIDEO_EDITS_URL,
  VIDEO_EXTENSIONS_URL,
  VIDEO_STATUS_URL,
  VIDEO_RESOLUTIONS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_MIN_DURATION,
  VIDEO_MAX_DURATION,
  DEFAULT_VIDEO_DURATION,
  EXTENSION_MIN_DURATION,
  EXTENSION_MAX_DURATION,
  DEFAULT_EXTENSION_DURATION,
  VIDEO_MAX_REFERENCE_AUDIOS,
  VIDEO_MAX_KEYFRAMES,
  VIDEO_TEXT_IMAGE_ONLY_MODELS,
  VIDEO_VOICE_AND_FRAME_MODELS,
  VIDEO_REFERENCE_LIMITS,
} from "./video";
export type {
  VideoGenerationsParams,
  VideoEditsParams,
  VideoExtensionsParams,
  XaiVideoPriceOptions,
  XaiMediaInput,
  XaiReferenceAudio,
  XaiVideoKeyframe,
  XaiVideoOutput,
  XaiVideoResolution,
  XaiVideoAspectRatio,
} from "./video";

// Hand-supplemented Imagine catalog (the generated `models` above is the TEXT
// catalog plus cost-less Imagine rows; ./models adds the published per-image /
// per-second rates and the grok-imagine-image-2.0 / -quality rows models.dev
// lacks).
export {
  imageModels,
  videoModels,
  IMAGE_MODEL_IDS,
  VIDEO_MODEL_IDS,
  IMAGE_PER_IMAGE_USD,
  IMAGE_2_0_PER_IMAGE_USD,
  IMAGE_QUALITY_PER_IMAGE_USD,
  VIDEO_PER_SECOND_USD,
  VIDEO_1_5_PER_SECOND_USD,
  VIDEO_1_5_LITE_PER_SECOND_USD,
  IMAGE_RATES,
  IMAGE_MEDIUM_RATES,
  VIDEO_RATES,
  VIDEO_INPUT_IMAGE_USD,
  IMAGE_MODEL_ALIASES,
  VIDEO_MODEL_ALIASES,
} from "./models";
export type { XaiImageGenerationModelId, XaiVideoGenerationModelId } from "./models";

// Every Imagine route returns JSON (an image list, or an async request_id to
// poll), and unmodel validates requests only — so no response checkers here.

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";
