/**
 * The image adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/vidu/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import type { ModelParamTable } from "../../core/unified/vocabulary/image";

/**
 * The two ids `POST /ent/v2/reference2image` accepts — `imageModels` in
 * `./models.ts`, which is the route-scoped catalog the validator itself uses.
 * Vidu's other nine models are video-only and warn as `unknown_model` here.
 */
export const MODELS = ["viduq2", "viduq1"] as const;

/**
 * The two models' per-model surface.
 *
 * `ratios` is each model's `IMAGE_ASPECT_RATIOS` row **minus `"auto"`** — a
 * Vidu keyword meaning "read the shape off the reference images", not a shape
 * — and `tiers` is the canonical half of `IMAGE_RESOLUTIONS`: viduq1 publishes
 * `["1080p"]` and viduq2 adds `2K` and `4K`, which is exactly the difference
 * between the two rows below. No `sizes`: this route has no pixel field, so
 * `size` types as `never` and still runs through `pixelsToRatio`.
 *
 * No extras — every other field on `Reference2ImageParams` is either canonical
 * (`prompt`, `seed`) or `images`, whose reference payload has no canonical
 * word yet and rides through `providerOptions.vidu`.
 */
export const VIDU_IMAGE_MODEL_PARAMS = {
  viduq2: {
    ratios: ["16:9", "9:16", "1:1", "3:4", "4:3", "21:9", "2:3", "3:2"],
    tiers: ["1k", "2k", "4k"],
  },
  viduq1: {
    ratios: ["16:9", "9:16", "1:1", "3:4", "4:3"],
    tiers: ["1k"],
  },
} as const satisfies ModelParamTable;
