/**
 * `unmodel/ideogram/values` — the **runtime** lists behind this provider's
 * unified surfaces (image, image-edit).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids, the per-model narrowing rows (allowed sizes, ratios,
 * durations, resolutions, voices, codecs, languages, timestamp granularities)
 * and the provider's own published enums. It is the value half of
 * `unmodel/ideogram/types`, for the client-side validation and the pickers
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
  IDEOGRAM_IMAGE_MODEL_PARAMS as IMAGE_MODEL_PARAMS,
  MODELS as IMAGE_MODELS,
} from "./image-params";

export {
  IDEOGRAM_IMAGE_EDIT_MODEL_PARAMS as IMAGE_EDIT_MODEL_PARAMS,
  MODELS as IMAGE_EDIT_MODELS,
} from "./image-edit-params";

export { RESOLUTIONS, RESOLUTIONS_V4 } from "./constraints";
