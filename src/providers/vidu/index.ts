export { video, TEXT2VIDEO_URL, TEXT2VIDEO_SUPPORT, videoConstraints } from "./video";
export type { Text2VideoParams } from "./video";

export {
  videoFromImage,
  IMG2VIDEO_URL,
  IMG2VIDEO_SUPPORT,
  videoFromImageConstraints,
} from "./video-from-image";
export type { Img2VideoParams } from "./video-from-image";

export {
  videoFromReference,
  REFERENCE2VIDEO_URL,
  REFERENCE2VIDEO_SUPPORT,
  SUBJECTS_MODELS,
  VIDEO_REFERENCE_MODEL,
  videoFromReferenceConstraints,
} from "./video-from-reference";
export type { Reference2VideoParams, ViduSubject } from "./video-from-reference";

export {
  imageFromReference,
  REFERENCE2IMAGE_URL,
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  IMAGE_COUNTS,
} from "./image-from-reference";
export type {
  Reference2ImageParams,
  ViduImageAspectRatio,
  ViduImageResolution,
} from "./image-from-reference";

export {
  VIDU_BASE_URL,
  VIDU_RESOLUTIONS,
  VIDU_ASPECT_RATIOS,
  VIDU_MOVEMENT_AMPLITUDES,
  VIDU_AUDIO_TYPES,
  VIDU_STYLES,
  PROMPT_MAX_CHARS,
  IMAGE_PROMPT_MAX_CHARS,
  PAYLOAD_MAX_CHARS,
} from "./shared";
export type {
  ModelRouteSupport,
  RouteSupport,
  ViduAspectRatio,
  ViduAudioType,
  ViduMovementAmplitude,
  ViduResolution,
  ViduStyle,
} from "./shared";

export { CREDIT_USD, models, videoModels, imageModels, provider } from "./models";
export type { ViduModelId, ViduImageModelId } from "./models";

export {
  DEFAULT_DURATION,
  DEFAULT_RESOLUTION,
  Q1_GENERATION_USD,
  Q1_GENERATION_OFF_PEAK_USD,
  videoCostUSD,
  imageCostUSD,
} from "./pricing";
export type { ViduRoute, VideoCostInputs } from "./pricing";

// Every route responds with an async task object; unmodel validates requests
// only, so this provider ships no response checker. `POST /ent/v2/
// start-end2video`, the template/audio/upscale routes and the task-management
// endpoints are documented but not yet validated here.
