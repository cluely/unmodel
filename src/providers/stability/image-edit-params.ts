/**
 * The image-edit adapter's **data**: the model list and the per-model narrowing
 * table.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/stability/values` publishes these for client-side pickers and the
 * adapter imports this provider's edit validators, their zod schemas and the
 * compile helpers in `core/unified/derive`. The adapter reads the very same
 * objects, so what is published and what is sent cannot drift.
 */

import type { ImageEditModelParamTable } from "../../core/unified/vocabulary/image-edit";

/**
 * The one Stable Image edit route `unmodel/image-edit` can name. A route
 * handle, not a wire value — none of Stability's edit routes has a `model`
 * field — and the same id `stability.imageEditRemoveBackground` prices the
 * request with (`./models.ts`).
 */
export const MODELS = ["stable-image-remove-background"] as const;

/**
 * `operations` is the whole row: the route takes a picture and an output
 * format, so there is no shape word to narrow and no extra to declare, and
 * `prompt`, `strength`, `n`, `seed` and the three shape words type as `never`.
 */
export const STABILITY_IMAGE_EDIT_MODEL_PARAMS = {
  "stable-image-remove-background": { operations: ["removeBackground"] },
} as const satisfies ImageEditModelParamTable;
