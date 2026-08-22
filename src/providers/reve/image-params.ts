/**
 * The image adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/reve/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image";
import { REVE_V1_ASPECT_RATIOS, type RevePostprocessingOperation } from "./shared";

/**
 * Every Reve model that *generates* an image, newest first.
 *
 * The `reve-edit@…` / `reve-remix@…` rows in `./models.ts` are deliberately
 * absent: they take a required input image and belong to `unmodel/image-edit`.
 */
export const MODELS = ["reve-v2-create", "reve-create@20250915"] as const;

/**
 * The two create routes' per-model surface.
 *
 * `ratios` is each route's own enum **minus `"auto"`**, and the subtraction is
 * the point: `"auto"` is a Reve keyword meaning "you pick", not a shape, and
 * the canonical `aspectRatio` is a `W:H`. Offering it would be a suggestion
 * `toRatioEnum` refuses at run time. A caller who wants it sends it through
 * `providerOptions.reve`, where it is spelled the way Reve spells it.
 *
 * No `sizes` on either route — neither has a pixel field — and no `tiers`
 * either: `resolution` is a declared gap on this adapter.
 *
 * `test_time_scaling` is v1-only among the create routes, which is the kind of
 * per-model difference this table exists to state.
 */
export const REVE_V2_SHAPES = [
  "4:1",
  "3:1",
  "21:9",
  "2:1",
  "17:9",
  "16:9",
  "3:2",
  "4:3",
  "5:4",
  "1:1",
  "4:5",
  "3:4",
  "2:3",
  "9:16",
  "1:2",
  "1:3",
  "1:4",
] as const;

export const REVE_IMAGE_MODEL_PARAMS = {
  "reve-v2-create": {
    ratios: REVE_V2_SHAPES,
    tiers: [],
    extras: { postprocessing: EXTRA as RevePostprocessingOperation[] },
  },
  "reve-create@20250915": {
    ratios: REVE_V1_ASPECT_RATIOS,
    tiers: [],
    extras: {
      postprocessing: EXTRA as RevePostprocessingOperation[],
      test_time_scaling: EXTRA as number,
    },
  },
} as const satisfies ModelParamTable;
