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
 * ## The edit row says two things by what it leaves out
 *
 * `ratios: []` types `aspectRatio` as `never`, and the absent `sizes` types
 * `size` as `never`: Edit With AI has no field for the shape of its output. The
 * route's `outputSize` is the CANVAS a result is positioned in, not the size it
 * is generated at, so compiling a shape onto it would send a different request
 * from the one the caller described.
 *
 * It has no `extras`. The fields that accompany an Edit With AI call are the
 * reference pictures, `editWithAI.additionalImages.<name>.imageFile`, and a
 * family whose key the CALLER chooses cannot be an extra — an extra is one
 * exact name. They travel in `providerOptions.photoroom`, which is typed from
 * the whole of both forms. And it has no `operations`: absent means `["edit"]`.
 *
 * ## The removal row
 *
 * `operations: ["removeBackground"]` is what makes `photoroom/remove-background`
 * a removal ref — at compile time and, through `resolveImageEditOperation`, at
 * run time. Four of `/v1/segment`'s seven fields are extras, under the route's
 * own snake_case names. The other three are not: `image_file` and `format` are
 * the canonical `image` and `outputFormat`, and `size` (a named downscale,
 * `preview` … `full`) cannot be an extra because its name is the canonical
 * `size` — it is `providerOptions.photoroom.size`.
 *
 * `crop` and `despill` take a boolean or the strings `"true"` / `"false"` the
 * route's OpenAPI schema types them as (see `./image-edit-remove-background.ts`).
 */

import { EXTRA } from "../../core/unified/derive";
import type { ImageEditModelParamTable } from "../../core/unified/vocabulary/image-edit";

/**
 * Synthetic ids — neither wire has a model field — and the same ones the two
 * validators resolve a request to (see the header of `./models.ts`):
 * `edit-with-ai` is the one `/v2/edit` mode `unmodel/image-edit` can name, a
 * picture and a sentence; `remove-background` is `/v1/segment`.
 */
export const MODELS = ["edit-with-ai", "remove-background"] as const;

export const PHOTOROOM_IMAGE_EDIT_MODEL_PARAMS = {
  "edit-with-ai": { ratios: [] },
  "remove-background": {
    operations: ["removeBackground"],
    extras: {
      bg_color: EXTRA as string,
      channels: EXTRA as "rgba" | "alpha",
      crop: EXTRA as boolean | "true" | "false",
      despill: EXTRA as boolean | "true" | "false",
    },
  },
} as const satisfies ImageEditModelParamTable;
