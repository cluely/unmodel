/**
 * `unmodel/lightricks/values` — the **runtime** lists behind this provider's
 * unified surface (video).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids, the per-model narrowing rows (allowed sizes, ratios,
 * durations, resolutions, voices, codecs, languages, timestamp granularities)
 * and the provider's own published enums. It is the value half of
 * `unmodel/lightricks/types`, for the client-side validation and the pickers
 * a type cannot draw.
 *
 * The category tables are **the same objects the adapters compile with** —
 * re-exported, never copied — so a picker built from `*_MODEL_PARAMS` and the
 * request the matching `unmodel/video` builds cannot disagree. They are read from
 * import-free `*-params` leaves rather than from the adapters, which is what
 * keeps one import off this provider's validator, zod schema and catalog;
 * `test/values-entries.test.ts` measures that against a real build.
 */

export {
  LIGHTRICKS_VIDEO_MODEL_PARAMS as VIDEO_MODEL_PARAMS,
  MODELS as VIDEO_MODELS,
} from "./video-params";

export { LTX_RESOLUTIONS } from "./pricing";

export {
  AUDIO_TO_VIDEO_MODELS,
  AUTOMATIC_DURATION_MODELS,
  GENERATION_MODELS,
  LONG_DURATIONS,
  LTX_API_VERSIONS,
  LTX_CAMERA_MOTIONS,
  LTX_FPS_VALUES,
} from "./shared";
