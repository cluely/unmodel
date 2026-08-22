/**
 * The image-edit adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/black-forest-labs/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image-edit";
import { BFL_ASPECT_RATIOS } from "./aspect";

/** Both Kontext routes — the `black-forest-labs/…` edit refs. */
export const MODELS = ["flux-kontext-pro", "flux-kontext-max"] as const;

/**
 * Both Kontext routes share `FluxKontextProInputs`, so this is one row twice.
 *
 * No `sizes`: the schema declares no width/height, which is the same fact
 * `unsupported.dimensions` states below — so `size` types as `never` and an
 * editor offers the shape instead. `ratios` is a **range** rather than an
 * enum ("between 21:9 and 9:21"), so `ratioFreeform` keeps the template tail
 * beside the thirteen presets: `"7:3"` is as legal as `"21:9"` and compiles to
 * the same thing.
 */
export const KONTEXT_ROW = {
  ratios: BFL_ASPECT_RATIOS,
  ratioFreeform: true,
  extras: {
    prompt_upsampling: EXTRA as boolean,
    safety_tolerance: EXTRA as number,
  },
} as const;

export const BFL_IMAGE_EDIT_MODEL_PARAMS = {
  "flux-kontext-pro": KONTEXT_ROW,
  "flux-kontext-max": KONTEXT_ROW,
} as const satisfies ModelParamTable;
