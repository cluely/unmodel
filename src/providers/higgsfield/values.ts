/**
 * `unmodel/higgsfield/values` — the **runtime** lists behind this provider's
 * unified surfaces (image, image-edit, video).
 *
 * Every export is a readonly (`as const`) array or table a browser can render:
 * the route ids each pack addresses, and the per-route narrowing rows (the
 * route's shapes, the tiers it can express, its clip lengths, the picture
 * roles it serves, where a count lands, and the extras it takes). It is the
 * value half of `unmodel/higgsfield/types`, for the client-side validation and
 * the pickers a type cannot draw.
 *
 * The tables are **the same objects the adapters compile with** — re-exported,
 * never copied — and they are read from the import-free `*-params` leaves, not
 * from the adapters, which is what keeps this entry off Higgsfield's
 * validators, its schema and its catalog; `test/values-entries.test.ts`
 * measures that against a real build.
 *
 * The rows are GENERATED from each route's own published schema, so a picker
 * rendered from them shows the route's declared vocabulary. Every route's
 * full parameter rows are `HIGGSFIELD_IMAGE_SHAPES` / `HIGGSFIELD_VIDEO_SHAPES`
 * on `unmodel/higgsfield`.
 */

export {
  HIGGSFIELD_IMAGE_MODEL_PARAMS as IMAGE_MODEL_PARAMS,
  MODELS as IMAGE_MODELS,
} from "./image-params";

export {
  HIGGSFIELD_IMAGE_EDIT_MODEL_PARAMS as IMAGE_EDIT_MODEL_PARAMS,
  MODELS as IMAGE_EDIT_MODELS,
} from "./image-edit-params";

export {
  HIGGSFIELD_VIDEO_MODEL_PARAMS as VIDEO_MODEL_PARAMS,
  MODELS as VIDEO_MODELS,
} from "./video-params";
