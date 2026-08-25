/**
 * `unmodel/fal/values` — the **runtime** lists behind this provider's unified
 * surfaces (image, image-edit).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the endpoint ids, and the per-endpoint narrowing rows (that
 * endpoint's own `image_size` presets, its `aspect_ratio` vocabulary, the
 * resolution tiers it can express, and the extras it takes). It is the value
 * half of `unmodel/fal/types`, for the client-side validation and the pickers
 * a type cannot draw.
 *
 * The tables are **the same objects the adapters compile with** — re-exported,
 * never copied — so a picker built from `*_MODEL_PARAMS` and the request the
 * matching `unmodel/image` builds cannot disagree. They are read from the
 * import-free `*-params` leaves rather than from the adapters, which is what
 * keeps this entry off fal's validators, its zod schemas and its catalog;
 * `test/values-entries.test.ts` measures that against a real build.
 *
 * One thing is worth knowing that is not true of the hand-written providers:
 * these rows are GENERATED from fal's own published OpenAPI documents. A
 * picker rendered from them is showing the endpoint's own declared vocabulary,
 * refreshed weekly, rather than a transcription of it.
 */

export {
  FAL_IMAGE_MODEL_PARAMS as IMAGE_MODEL_PARAMS,
  MODELS as IMAGE_MODELS,
} from "./image-params";

export {
  FAL_IMAGE_EDIT_MODEL_PARAMS as IMAGE_EDIT_MODEL_PARAMS,
  MODELS as IMAGE_EDIT_MODELS,
} from "./image-edit-params";
