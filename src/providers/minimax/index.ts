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
import type { ExactKeys, Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { withApiTarget } from "../../core/translate/media-retarget";
import type { MediaApiMember } from "../../retarget/types";
import { tts as ttsBase, type MinimaxSdkTargets, type T2aParams } from "./tts";
import { minimaxTtsToFal, type MinimaxTtsFalOverlap } from "./fal-target";

/**
 * `minimax.tts`, with `.toApi("fal")` attached.
 *
 * Wired here rather than in `./tts.ts` so `unmodel/tts` — which reaches this
 * provider through `./unified-tts.ts` → `./tts` — pays nothing for a seam it
 * cannot call. See `core/translate/media-retarget.ts`.
 */
export const tts = withApiTarget(
  ttsBase as unknown as Parameters<typeof withApiTarget<T2aParams, object>>[0],
  minimaxTtsToFal,
) as unknown as {
  <T extends T2aParams>(
    params: T & ExactKeys<T, T2aParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, MinimaxSdkTargets<T>> & MediaApiMember<MinimaxTtsFalOverlap, T["model"]>;
  safe<T extends T2aParams>(
    params: T & ExactKeys<T, T2aParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<
    Validated<T, MinimaxSdkTargets<T>> & MediaApiMember<MinimaxTtsFalOverlap, T["model"]>
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
};

export { MINIMAX_TTS_FAL_OVERLAP, MINIMAX_TTS_FAL_REFUSALS } from "./fal-target";

export {
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

// T2A answers JSON and reports failure IN BAND: the reference declares one
// HTTP response (200) and puts the outcome on `base_resp.status_code`, so a
// caller that branches on `res.ok` reads audio off a failed request.
// `checkTts` is that read-back — sanity, plus the billed character count
// priced against the catalog. The video routes answer an async task handle
// carrying the same envelope; polling is transport and stays out of scope.
export { checkTts } from "./tts-check";
export type { MinimaxT2aResponseLike, MinimaxBaseRespStatus } from "./tts-check";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";

/**
 * The fal bodies this provider's `.toApi("fal")` maps onto. One type-only
 * line, so a consumer emitting its own declarations can name the result — see
 * src/core/carriers.ts.
 */
export type { FalSpeech02Hd, FalSpeech28Hd, FalSpeech28Turbo } from "./fal-target";
export type { MinimaxTtsFalOverlap } from "./fal-target";
