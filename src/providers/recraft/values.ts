/**
 * `unmodel/recraft/values` — the **runtime** lists behind this provider's
 * unified surfaces (image, image-edit).
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids, the per-model narrowing rows (allowed sizes, ratios,
 * durations, resolutions, voices, codecs, languages, timestamp granularities)
 * and the provider's own published enums. It is the value half of
 * `unmodel/recraft/types`, for the client-side validation and the pickers
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
  RECRAFT_IMAGE_MODEL_PARAMS as IMAGE_MODEL_PARAMS,
  MODELS as IMAGE_MODELS,
} from "./image-params";

export {
  RECRAFT_IMAGE_EDIT_MODEL_PARAMS as IMAGE_EDIT_MODEL_PARAMS,
  MODELS as IMAGE_EDIT_MODELS,
} from "./image-edit-params";

export {
  ASPECT_RATIOS,
  UNATTRIBUTED_SIZE_VALUES,
  V2_V3_SIZES,
  V4_PRO_SIZES,
  V4_STANDARD_SIZES,
} from "./constraints";

export { IMAGE_TO_IMAGE_MODELS, V3_ONLY_MODELS } from "./models";

export {
  RECRAFT_V2_STYLES,
  RECRAFT_V2_VECTOR_STYLES,
  RECRAFT_V3_STYLES,
  RECRAFT_V3_VECTOR_STYLES,
} from "./styles";
