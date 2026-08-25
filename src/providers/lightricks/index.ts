import type { ExactKeys, Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { withApiTarget } from "../../core/translate/media-retarget";
import type { MediaApiMember } from "../../retarget/types";
import { video as videoBase, type LightricksSdkTargets, type TextToVideoParams } from "./video";
import { lightricksVideoToFal, type LightricksVideoFalOverlap } from "./fal-target";

export { TEXT_TO_VIDEO_URL, TEXT_TO_VIDEO_V1_URL, TEXT_TO_VIDEO_ENDPOINT } from "./video";
export type { TextToVideoParams } from "./video";

/**
 * `lightricks.video`, with `.toApi("fal")` attached.
 *
 * Wired here rather than in `./video.ts` so `unmodel/video` — which reaches
 * this provider through `./unified-video.ts` → `./video` — pays nothing for a
 * seam it cannot call. See `core/translate/media-retarget.ts`.
 */
export const video = withApiTarget(
  videoBase as unknown as Parameters<typeof withApiTarget<TextToVideoParams, object>>[0],
  lightricksVideoToFal,
) as unknown as {
  <T extends TextToVideoParams>(
    params: T & ExactKeys<T, TextToVideoParams>,
    options?: ValidateOptions<T>,
  ): Validated<Omit<T, "api_version">, LightricksSdkTargets<Omit<T, "api_version">>> &
    MediaApiMember<LightricksVideoFalOverlap, T["model"]>;
  safe<T extends TextToVideoParams>(
    params: T & ExactKeys<T, TextToVideoParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<
    Validated<Omit<T, "api_version">, LightricksSdkTargets<Omit<T, "api_version">>> &
      MediaApiMember<LightricksVideoFalOverlap, T["model"]>
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
};

export { LIGHTRICKS_VIDEO_FAL_OVERLAP, LIGHTRICKS_VIDEO_FAL_REFUSALS } from "./fal-target";

export {
  videoFromImage,
  IMAGE_TO_VIDEO_URL,
  IMAGE_TO_VIDEO_V1_URL,
  IMAGE_TO_VIDEO_ENDPOINT,
  NO_LAST_FRAME_MODELS,
} from "./video-from-image";
export type { ImageToVideoParams } from "./video-from-image";

export {
  videoFromAudio,
  AUDIO_TO_VIDEO_URL,
  AUDIO_TO_VIDEO_V1_URL,
  AUDIO_TO_VIDEO_ENDPOINT,
  AUDIO_TO_VIDEO_RESOLUTIONS,
  DEFAULT_AUDIO_TO_VIDEO_MODEL,
} from "./video-from-audio";
export type { AudioToVideoParams } from "./video-from-audio";

export {
  LTX_BASE_URL,
  LTX_API_VERSIONS,
  DEFAULT_API_VERSION,
  DEFAULT_FPS,
  LTX_CAMERA_MOTIONS,
  LTX_RESOLUTIONS,
  LTX_FPS_VALUES,
  LONG_DURATIONS,
  GENERATION_MODELS,
  AUDIO_TO_VIDEO_MODELS,
  AUTOMATIC_DURATION_MODELS,
  SUPPORT_MATRIX,
  ltxUrl,
} from "./shared";
export type {
  LtxApiVersion,
  LtxCameraMotion,
  LtxDuration,
  LtxFps,
  LtxResolution,
  MatrixRow,
} from "./shared";

export {
  LTX_RESOLUTION_TIERS,
  VIDEO_USD_PER_SECOND,
  AUDIO_TO_VIDEO_USD_PER_SECOND,
  EDIT_USD_PER_SECOND,
  resolutionTier,
  videoCostUSD,
} from "./pricing";
export type { LtxResolutionTier } from "./pricing";

// Every route responds with an async job object (v2) or the finished asset
// (v1); unmodel validates requests only, so this provider ships no response
// checker. `POST /v2/retake`, `/v2/extend`, `/v2/video-to-video-hdr`,
// `/v2/video-to-video-reframe` and `POST /v1/upload` are documented but not
// yet validated here.
export { models, provider } from "./models";
export type { LightricksModelId } from "./models";
