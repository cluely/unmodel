// The corroborated `POST /v1/videos/*` family — the primary video validators.
// `model_name` is a body field; both routes are documented on Kling's own
// apiReference pages (see ./models.ts for the provenance of both families).
import type { ExactKeys, Validated } from "../../core/request";
import type { ValidateOptions } from "../../core/options";
import type { ValidateResult } from "../../core/result";
import type { EndpointConstraints } from "../../core/constraint-types";
import { withApiTarget } from "../../core/translate/media-retarget";
import type { MediaApiMember } from "../../retarget/types";
import {
  video as videoBase,
  type KlingSdkTargets,
  type TextToVideoArm,
  type TextToVideoParams,
} from "./video";
import {
  videoFromImage as videoFromImageBase,
  type ImageToVideoArm,
  type ImageToVideoParams,
} from "./video-from-image";
import {
  klingVideoFromImageToFal,
  klingVideoToFal,
  type KlingVideoFalOverlap,
  type KlingVideoFromImageFalOverlap,
} from "./fal-target";
import type { KlingV1VideoModelId } from "./models";

export { TEXT2VIDEO_URL, TEXT2VIDEO_MODELS } from "./video";
export type { TextToVideoParams, TextToVideoArm } from "./video";

export {
  IMAGE2VIDEO_URL,
  IMAGE2VIDEO_MODELS,
  MAX_ELEMENT_LIST,
  MAX_VOICE_LIST,
} from "./video-from-image";
export type {
  ImageToVideoParams,
  ImageToVideoArm,
  KlingDynamicMask,
  KlingTrajectoryPoint,
} from "./video-from-image";

/** What `model_name` may be: a catalogued id, or any string at run time. */
type KlingVideoModelInput = KlingV1VideoModelId | (string & {});

/**
 * `kling.video`, with `.toApi("fal")` attached.
 *
 * Wired here rather than in `./video.ts` so `unmodel/video` — which reaches
 * this provider through `./unified-video.ts` → `./video` — pays nothing for a
 * seam it cannot call. See `core/translate/media-retarget.ts`.
 *
 * `.toApi` exists for the three ids fal serves (`kling-v3`, `kling-v2-6`,
 * `kling-v2-5-turbo`) and nowhere else; on the other six the member is simply
 * not on the type, which is the honest answer for a hand-written overlap
 * table. See `MediaApiMember` for why that differs from chat's permissive
 * degradation.
 */
export const video = withApiTarget(
  videoBase as unknown as Parameters<typeof withApiTarget<TextToVideoParams, object>>[0],
  klingVideoToFal,
) as unknown as {
  <M extends KlingVideoModelInput, T extends TextToVideoArm<M>>(
    params: T & TextToVideoArm<M> & { model_name?: M } & ExactKeys<T, TextToVideoArm<M>>,
    options?: ValidateOptions<T>,
  ): Validated<T, KlingSdkTargets<T>> & MediaApiMember<KlingVideoFalOverlap, M>;
  safe<M extends KlingVideoModelInput, T extends TextToVideoArm<M>>(
    params: T & TextToVideoArm<M> & { model_name?: M } & ExactKeys<T, TextToVideoArm<M>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<Validated<T, KlingSdkTargets<T>> & MediaApiMember<KlingVideoFalOverlap, M>>;
  constraintsFor(modelId: string): EndpointConstraints[];
};

/** `kling.videoFromImage`, with `.toApi("fal")` attached. See {@link video}. */
export const videoFromImage = withApiTarget(
  videoFromImageBase as unknown as Parameters<typeof withApiTarget<ImageToVideoParams, object>>[0],
  klingVideoFromImageToFal,
) as unknown as {
  <M extends KlingVideoModelInput, T extends ImageToVideoArm<M>>(
    params: T & ImageToVideoArm<M> & { model_name?: M } & ExactKeys<T, ImageToVideoArm<M>>,
    options?: ValidateOptions<T>,
  ): Validated<T, KlingSdkTargets<T>> & MediaApiMember<KlingVideoFromImageFalOverlap, M>;
  safe<M extends KlingVideoModelInput, T extends ImageToVideoArm<M>>(
    params: T & ImageToVideoArm<M> & { model_name?: M } & ExactKeys<T, ImageToVideoArm<M>>,
    options?: ValidateOptions<T>,
  ): ValidateResult<
    Validated<T, KlingSdkTargets<T>> & MediaApiMember<KlingVideoFromImageFalOverlap, M>
  >;
  constraintsFor(modelId: string): EndpointConstraints[];
};

export {
  KLING_VIDEO_FAL_OVERLAP,
  KLING_VIDEO_FROM_IMAGE_FAL_OVERLAP,
  KLING_VIDEO_FAL_REFUSALS,
} from "./fal-target";

// EXPERIMENTAL — the path-addressed family (`POST /text-to-video/{model}`,
// `/image-to-video/{model}`, `/omni-video/{model}`), recovered from the doc
// site's JS bundle and corroborated by nothing. Each module carries the full
// EXPERIMENTAL note; prefer `video` / `videoFromImage` above.
export { videoV3, textToVideoV3Url, TEXT_TO_VIDEO_V3_RULES } from "./video-v3";
export type { TextToVideoV3Params, TextToVideoV3Settings } from "./video-v3";

export {
  videoV3FromImage,
  imageToVideoV3Url,
  IMAGE_TO_VIDEO_V3_RULES,
} from "./video-v3-from-image";
export type { ImageToVideoV3Params, ImageToVideoV3Settings } from "./video-v3-from-image";

export {
  videoOmni,
  omniVideoUrl,
  OMNI_VIDEO_MODELS,
  OMNI_VIDEO_RULES,
  VIDEO_INPUT_TYPES,
} from "./video-omni";
export type { OmniVideoParams, OmniVideoSettings, KlingOmniVideoModelId } from "./video-omni";

export {
  image,
  IMAGE_GENERATIONS_URL,
  DEFAULT_IMAGE_MODEL,
  KLING_IMAGE_ASPECT_RATIOS,
  KLING_IMAGE_RESOLUTIONS,
  KLING_IMAGE_REFERENCES,
} from "./image";
export type { ImageGenerationsParams, KlingImageAspectRatio, KlingImageResolution } from "./image";

export {
  imageOmni,
  OMNI_IMAGE_URL,
  DEFAULT_OMNI_IMAGE_MODEL,
  OMNI_IMAGE_RESOLUTIONS,
  OMNI_IMAGE_ASPECT_RATIOS,
  OMNI_RESULT_TYPES,
  OMNI_SERIES_AMOUNTS,
} from "./image-omni";
export type { OmniImageParams, KlingOmniImageResolution } from "./image-omni";

export {
  KLING_BASE_URL,
  KLING_CN_BASE_URL,
  KLING_ASPECT_RATIOS,
  KLING_RESOLUTIONS,
  KLING_AUDIO_MODES,
  KLING_MODES,
  KLING_SOUND,
  KLING_CONTENT_TYPES,
  PROMPT_MAX_CHARS,
  V1_PROMPT_MAX_CHARS,
  SHOT_PROMPT_MAX_CHARS,
  MAX_SHOTS,
  MAX_ELEMENTS,
  IMAGE_MAX_BYTES,
  IMAGE_MIN_DIMENSION,
  IMAGE_FORMATS,
} from "./shared";
export type {
  KlingAspectRatio,
  KlingAudio,
  KlingContent,
  KlingContentType,
  KlingDuration,
  KlingMode,
  KlingOptions,
  KlingResolution,
  KlingWatermarkInfo,
  RouteModelRules,
  RouteRules,
} from "./shared";

export {
  DEFAULT_V1_MODEL,
  KLING_SHOT_TYPES,
  KLING_CAMERA_TYPES,
  KLING_CAMERA_AXES,
  CAMERA_AXIS_MIN,
  CAMERA_AXIS_MAX,
  V1_MODEL_RULES,
} from "./v1-routes";
export type {
  KlingCameraConfig,
  KlingCameraControl,
  KlingCameraType,
  KlingShot,
  KlingShotType,
  KlingV1Duration,
  V1ModelRules,
} from "./v1-routes";

export {
  MODE_RESOLUTION,
  DEFAULT_RESOLUTION,
  DEFAULT_MODE,
  DEFAULT_DURATION,
  pricingKey,
  videoCostUSD,
  imageCostUSD,
} from "./pricing";
export type { ImageMode, ImageCostInputs, VideoCostInputs } from "./pricing";

// Every route responds with an async task object; unmodel validates requests
// only, so this provider ships no response checker. Motion Control, Elements,
// Avatar/TTS, lip sync, audio generation, video effects, outpainting, virtual
// try-on, video extension, `POST /v1/images/multi-image2image` and the
// account/asset endpoints are documented but not yet validated here.
// `models` is the provider-wide view; four ids name both a video and an image
// model, so it carries a merged dual-kind row for those. Reach for
// `videoModels` / `imageModels` whenever one kind's rate is what you mean.
export {
  models,
  videoModels,
  v1VideoModels,
  pathVideoModels,
  imageModels,
  omniImageModels,
  provider,
} from "./models";
export type {
  KlingModelId,
  KlingVideoModelId,
  KlingV1VideoModelId,
  KlingPathVideoModelId,
  KlingImageModelId,
  KlingOmniImageModelId,
} from "./models";

// Declaration-portability carriers. One type-only line; see
// src/core/carriers.ts for why a consumer that emits its own `.d.ts` cannot
// name this entry's inferred result types without it (TS2742 / TS2883).
export type * from "../../core/carriers";

/**
 * The fal bodies this provider's `.toApi("fal")` maps onto. One type-only
 * line, so a consumer emitting its own declarations can name the result — see
 * src/core/carriers.ts.
 */
export type { FalKlingV25Image, FalKlingV25Text, FalKlingV26Image, FalKlingV26Text, FalKlingV3Image, FalKlingV3Text } from "./fal-target";
export type { KlingVideoFalOverlap, KlingVideoFromImageFalOverlap } from "./fal-target";
