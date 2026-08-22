/**
 * `unmodel/pixverse/values` — the **runtime** lists behind this provider's
 * unified surface (video).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids, the per-model narrowing rows (allowed sizes, ratios,
 * durations, resolutions, voices, codecs, languages, timestamp granularities)
 * and the provider's own published enums. It is the value half of
 * `unmodel/pixverse/types`, for the client-side validation and the pickers
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
  PIXVERSE_VIDEO_MODEL_PARAMS as VIDEO_MODEL_PARAMS,
  MODELS as VIDEO_MODELS,
} from "./video-params";

export { QUALITIES } from "./pricing";

export {
  AUDIO_SWITCH_MODELS,
  LEGACY_ASPECT_RATIOS,
  LEGACY_AUDIO_MODELS,
  MULTI_CLIP_MODELS,
  PER_SECOND_MODELS,
  PIXVERSE_MOTION_MODES,
  PIXVERSE_QUALITIES,
  WIDE_ASPECT_RATIOS,
} from "./shared";
