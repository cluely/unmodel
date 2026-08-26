import type { ExactKeys, Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { withApiTarget } from "../../core/translate/media-retarget";
import type { MediaApiMember } from "../../retarget/types";
import { video as videoBase, type PixverseSdkTargets, type TextToVideoParams } from "./video";
import { pixverseVideoToFal, type PixverseVideoFalOverlap } from "./fal-target";

export { TEXT_TO_VIDEO_URL, videoConstraints } from "./video";
export type { TextToVideoParams } from "./video";

/**
 * `pixverse.video`, with `.toApi("fal")` attached.
 *
 * The retarget is wired **here** rather than inside `./video.ts` on purpose:
 * `unmodel/video` reaches this provider through `./unified-video.ts`, which
 * imports `./video` directly, so a seam wired in that module's `finalize`
 * would put the retarget engine and the overlap table into a pack that has no
 * way to call `.toApi` at all. `./index.ts` is the one module only
 * `unmodel/pixverse` imports. See `core/translate/media-retarget.ts`.
 *
 * The declared type is restated rather than inferred because
 * `withApiTarget` is generic over the *result* and cannot add a member to the
 * return of a generic call signature; the `MediaApiMember` intersection is
 * what makes `.toApi` exist for `model: "v6"` and nowhere else.
 */
export const video = withApiTarget(
  videoBase as unknown as Parameters<typeof withApiTarget<TextToVideoParams, object>>[0],
  pixverseVideoToFal,
) as unknown as {
  <T extends TextToVideoParams>(
    params: T & ExactKeys<T, TextToVideoParams>,
    options?: ValidateOptions<T>,
  ): Validated<T, PixverseSdkTargets<T>> & MediaApiMember<PixverseVideoFalOverlap, T["model"]>;
  safe<T extends TextToVideoParams>(
    params: T & ExactKeys<T, TextToVideoParams>,
    options?: ValidateOptions<T>,
  ): ValidateResult<
    Validated<T, PixverseSdkTargets<T>> & MediaApiMember<PixverseVideoFalOverlap, T["model"]>
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
};

export { PIXVERSE_VIDEO_FAL_OVERLAP, PIXVERSE_VIDEO_FAL_REFUSALS } from "./fal-target";

export { videoFromImage, IMAGE_TO_VIDEO_URL } from "./video-from-image";
export type { ImageToVideoParams } from "./video-from-image";

export {
  PIXVERSE_BASE_URL,
  IMAGE_UPLOAD_URL,
  PIXVERSE_QUALITIES,
  LEGACY_ASPECT_RATIOS,
  WIDE_ASPECT_RATIOS,
  PIXVERSE_MOTION_MODES,
  PER_SECOND_MODELS,
  AUDIO_SWITCH_MODELS,
  MULTI_CLIP_MODELS,
  LEGACY_AUDIO_MODELS,
  DURATIONS,
  PER_SECOND_DURATION,
  PROMPT_MAX_CHARS,
  SEED_MIN,
  SEED_MAX,
  videoResultUrl,
} from "./shared";
export type {
  PixverseAspectRatio,
  PixverseMotionMode,
  PixverseQualityValue,
} from "./shared";

export { QUALITIES, videoCredits, videoCostUSD } from "./pricing";
export type { PixverseQuality, VideoCostInputs } from "./pricing";

// Every generation route responds `{ ErrCode, ErrMsg, Resp: { video_id } }`
// and is polled via `GET /openapi/v2/video/result/{video_id}`; unmodel
// validates requests only, so this provider ships no response checker. The
// transition, extend, fusion, effects, restyle, swap, mimic, modify, lip-sync,
// sound-effect, upscale and image-template routes are documented but not yet
// validated here.
export { models, provider, CREDIT_USD } from "./models";
export type { PixverseModelId } from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";

/**
 * The fal bodies this provider's `.toApi("fal")` maps onto. One type-only
 * line, so a consumer emitting its own declarations can name the result — see
 * src/core/carriers.ts.
 */
export type { FalPixverseV6 } from "./fal-target";
export type { PixverseVideoFalOverlap } from "./fal-target";
