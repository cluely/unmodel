/**
 * `unmodel/photoroom/values` — the **runtime** lists behind this provider's
 * unified surface (image-edit), and the form-field tables of its two routes.
 *
 * Every export here is a readonly (`as const`) array or table a browser can
 * render: the model ids, the per-model narrowing rows, the generated field
 * tables, the feature-header names and the values Photoroom documents for each,
 * and the byte limits.
 *
 * The category table is **the same object the adapter compiles with** —
 * re-exported, never copied — so a picker built from `IMAGE_EDIT_MODEL_PARAMS`
 * and the request the matching `unmodel/image-edit` builds cannot disagree. It
 * is read from the import-free `./image-edit-params.ts` leaf rather than from
 * the adapter, which is what keeps this entry off this provider's validators,
 * their zod leaves and its catalog; `test/values-entries.test.ts` measures that
 * against a real build.
 *
 * The exports a form builder gets the most from:
 *
 * - `PHOTOROOM_EDIT_FIELDS` / `PHOTOROOM_EDIT_FAMILIES` — every field of
 *   `POST /v2/edit` with its type, enum, range and default, generated from the
 *   committed OpenAPI snapshot. Photoroom does not refuse a field it does not
 *   know (it answers 200, bills the call and names the field in a response
 *   header), so a form drawn from this table is the only way a user cannot
 *   mistype one.
 * - `PHOTOROOM_SEGMENT_FIELDS` — the same for `POST /v1/segment`.
 * - `PHOTOROOM_REQUEST_HEADERS` and the five `*_VERSIONS` / `*_VALUES` lists —
 *   the features that are switched by a request header and appear in no schema.
 */

export {
  PHOTOROOM_IMAGE_EDIT_MODEL_PARAMS as IMAGE_EDIT_MODEL_PARAMS,
  MODELS as IMAGE_EDIT_MODELS,
} from "./image-edit-params";

export { PHOTOROOM_EDIT_FAMILIES, PHOTOROOM_EDIT_FIELDS } from "./gen/image-edit-fields.gen";
export { PHOTOROOM_SEGMENT_FIELDS } from "./gen/image-edit-remove-background-fields.gen";

export {
  PHOTOROOM_AI_BACKGROUND_MODEL_VERSIONS,
  PHOTOROOM_AI_SHADOWS_MODEL_VERSIONS,
  PHOTOROOM_AI_UPSCALE_MODEL_VERSIONS,
  PHOTOROOM_EDIT_MAX_BYTES,
  PHOTOROOM_EDIT_WITH_AI_MAX_ADDITIONAL_IMAGES,
  PHOTOROOM_HD_BACKGROUND_REMOVAL_VALUES,
  PHOTOROOM_IRONING_MODEL_VERSIONS,
  PHOTOROOM_REQUEST_HEADERS,
  PHOTOROOM_RESPONSE_HEADERS,
  PHOTOROOM_SEGMENT_MAX_BYTES,
} from "./constants";
