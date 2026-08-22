/**
 * `unmodel/kling/values` — the **runtime** lists behind this provider's
 * unified surfaces (image, video).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids, the per-model narrowing rows (allowed sizes, ratios,
 * durations, resolutions, voices, codecs, languages, timestamp granularities)
 * and the provider's own published enums. It is the value half of
 * `unmodel/kling/types`, for the client-side validation and the pickers
 * a type cannot draw.
 *
 * The category tables are **the same objects the adapters compile with** —
 * re-exported, never copied — so a picker built from `*_MODEL_PARAMS` and the
 * request the matching `unmodel/image` builds cannot disagree. They are read from
 * import-free `*-params` leaves rather than from the adapters, which is what
 * keeps one import off this provider's validator, zod schema and catalog;
 * `test/values-entries.test.ts` measures that against a real build.
 */

export {
  KLING_IMAGE_MODEL_PARAMS as IMAGE_MODEL_PARAMS,
  MODELS as IMAGE_MODELS,
} from "./image-params";

export {
  KLING_VIDEO_MODEL_PARAMS as VIDEO_MODEL_PARAMS,
  MODELS as VIDEO_MODELS,
} from "./video-params";

export {
  DURATIONS_3_10,
  DURATIONS_3_15,
  DURATIONS_5_10,
  IMAGE_FORMATS,
  KLING_ASPECT_RATIOS,
  KLING_AUDIO_MODES,
  KLING_CONTENT_TYPES,
  KLING_IMAGE_ASPECT_RATIOS,
  KLING_IMAGE_REFERENCES,
  KLING_IMAGE_RESOLUTIONS,
  KLING_MODES,
  KLING_RESOLUTIONS,
  KLING_SOUND,
  OMNI_IMAGE_RESOLUTIONS,
  OMNI_RESULT_TYPES,
  OMNI_SERIES_AMOUNTS,
  TEXT2VIDEO_MODELS,
} from "./shared";

export { KLING_CAMERA_AXES, KLING_CAMERA_TYPES, KLING_SHOT_TYPES } from "./v1-routes";
