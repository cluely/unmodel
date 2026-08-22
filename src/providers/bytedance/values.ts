/**
 * `unmodel/bytedance/values` — the **runtime** lists behind this provider's
 * unified surfaces (image, video).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids, the per-model narrowing rows (allowed sizes, ratios,
 * durations, resolutions, voices, codecs, languages, timestamp granularities)
 * and the provider's own published enums. It is the value half of
 * `unmodel/bytedance/types`, for the client-side validation and the pickers
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
  BYTEDANCE_IMAGE_MODEL_PARAMS as IMAGE_MODEL_PARAMS,
  MODELS as IMAGE_MODELS,
} from "./image-params";

export {
  BYTEDANCE_VIDEO_MODEL_PARAMS as VIDEO_MODEL_PARAMS,
  MODELS as VIDEO_MODELS,
} from "./video-params";

export {
  CONTENT_ROLES,
  IMAGE_BACKGROUNDS,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_RESPONSE_FORMATS,
  IMAGE_SIZE_KEYWORDS,
  OMNI_REFERENCE_TASK_TYPES,
  PROMPT_OPTIMIZE_MODES,
  SEQUENTIAL_IMAGE_GENERATION,
  SERVICE_TIERS,
  VIDEO_OUTPUT_FORMATS,
  VIDEO_RATIOS,
} from "./constraints";
