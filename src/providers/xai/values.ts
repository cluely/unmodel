/**
 * `unmodel/xai/values` — the **runtime** lists behind this provider's unified
 * surfaces (image, video).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids and the per-model narrowing rows (allowed ratios,
 * tiers, resolutions). It is the value half of `unmodel/xai/types`, for the
 * client-side validation and the pickers a type cannot draw.
 *
 * The category tables are **the same objects the adapters compile with** —
 * re-exported, never copied — so a picker built from `*_MODEL_PARAMS` and the
 * request the matching `unmodel/image` / `unmodel/video` builds cannot
 * disagree. They are read from import-free `*-params` leaves rather than from
 * the adapters, which is what keeps one import off this provider's validator,
 * zod schema and catalog.
 */

export {
  XAI_IMAGE_MODEL_PARAMS as IMAGE_MODEL_PARAMS,
  MODELS as IMAGE_MODELS,
  XAI_IMAGE_RATIOS,
} from "./image-params";

export {
  XAI_VIDEO_MODEL_PARAMS as VIDEO_MODEL_PARAMS,
  MODELS as VIDEO_MODELS,
} from "./video-params";
