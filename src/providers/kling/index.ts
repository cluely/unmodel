// The corroborated `POST /v1/videos/*` family — the primary video validators.
// `model_name` is a body field; both routes are documented on Kling's own
// apiReference pages (see ./models.ts for the provenance of both families).
export { textToVideo, TEXT2VIDEO_URL, TEXT2VIDEO_MODELS } from "./text2video";
export type { TextToVideoParams } from "./text2video";

export {
  imageToVideo,
  IMAGE2VIDEO_URL,
  IMAGE2VIDEO_MODELS,
  MAX_ELEMENT_LIST,
  MAX_VOICE_LIST,
} from "./image2video";
export type {
  ImageToVideoParams,
  KlingDynamicMask,
  KlingTrajectoryPoint,
} from "./image2video";

// EXPERIMENTAL — the path-addressed family (`POST /text-to-video/{model}`,
// `/image-to-video/{model}`, `/omni-video/{model}`), recovered from the doc
// site's JS bundle and corroborated by nothing. Each module carries the full
// EXPERIMENTAL note; prefer `textToVideo` / `imageToVideo` above.
export { textToVideoV3, textToVideoV3Url, TEXT_TO_VIDEO_V3_RULES } from "./text-to-video";
export type { TextToVideoV3Params, TextToVideoV3Settings } from "./text-to-video";

export { imageToVideoV3, imageToVideoV3Url, IMAGE_TO_VIDEO_V3_RULES } from "./image-to-video";
export type { ImageToVideoV3Params, ImageToVideoV3Settings } from "./image-to-video";

export {
  omniVideo,
  omniVideoUrl,
  OMNI_VIDEO_MODELS,
  OMNI_VIDEO_RULES,
  VIDEO_INPUT_TYPES,
} from "./omni-video";
export type { OmniVideoParams, OmniVideoSettings, KlingOmniVideoModelId } from "./omni-video";

export {
  image,
  IMAGE_GENERATIONS_URL,
  DEFAULT_IMAGE_MODEL,
  KLING_IMAGE_ASPECT_RATIOS,
  KLING_IMAGE_RESOLUTIONS,
  KLING_IMAGE_REFERENCES,
} from "./image";
export type {
  ImageGenerationsParams,
  KlingImageAspectRatio,
  KlingImageResolution,
} from "./image";

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
