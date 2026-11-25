/**
 * The image-edit adapter's **data**: the model list and the per-model narrowing
 * table.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/photoroom/values` publishes these for client-side pickers and the
 * adapter imports this provider's validator, its zod leaves and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 *
 * ## One row, and it says two things by what it leaves out
 *
 * `ratios: []` types `aspectRatio` as `never`, and the absent `sizes` types
 * `size` as `never`: Edit With AI has no field for the shape of its output. The
 * route's `outputSize` is the CANVAS a result is positioned in, not the size it
 * is generated at, so compiling a shape onto it would send a different request
 * from the one the caller described.
 *
 * There are no `extras`. The fields that accompany an Edit With AI call are the
 * reference pictures, `editWithAI.additionalImages.<name>.imageFile`, and a
 * family whose key the CALLER chooses cannot be an extra — an extra is one
 * exact name. They travel in `providerOptions.photoroom`, which is typed from
 * the whole `/v2/edit` form.
 */

import type { ModelParamTable } from "../../core/unified/vocabulary/image-edit";

/**
 * The one `/v2/edit` mode `unmodel/image-edit` can name: a picture and a
 * sentence. A synthetic id — the wire has no model field — and the same one
 * `photoroom.imageEdit` resolves a request with `editWithAI.mode` to (see the
 * header of `./models.ts`).
 */
export const MODELS = ["edit-with-ai"] as const;

export const PHOTOROOM_IMAGE_EDIT_MODEL_PARAMS = {
  "edit-with-ai": { ratios: [] },
} as const satisfies ModelParamTable;
