/**
 * The image adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/bria/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image";
import { BRIA_ASPECT_RATIOS } from "./shared";

/** The two generate rows in the catalog — the ref union for `bria/…`. */
export const MODELS = ["FIBO", "FIBO-lite"] as const;

/**
 * The two generate routes' per-model surface.
 *
 * Neither has a width/height field, so no `sizes` row exists and `size` types
 * as `never` — the nine-value `aspect_ratio` enum is the whole shape
 * vocabulary. The tier split is the interesting half and it is real: the full
 * route publishes `resolution: "1MP" | "4MP"`, and the lite route has no such
 * field at all, so its `tiers` is empty and `resolution` is a compile error
 * rather than a value with nowhere to go.
 *
 * `steps_num` is the same story one level down: 35–50 on the full route, and
 * an explicit `unsupported_param` on lite ("`steps_num` is not part of the
 * Fibo Lite request schema"). Declaring it on one row and not the other is
 * what makes that a compile error too.
 */
export const BRIA_SHARED_EXTRAS = {
  structured_prompt: EXTRA as string,
  ip_signal: EXTRA as boolean,
  prompt_content_moderation: EXTRA as boolean,
  visual_input_content_moderation: EXTRA as boolean,
  visual_output_content_moderation: EXTRA as boolean,
} as const;

export const BRIA_IMAGE_MODEL_PARAMS = {
  FIBO: {
    ratios: BRIA_ASPECT_RATIOS,
    tiers: ["1k", "2k"],
    extras: { steps_num: EXTRA as number, ...BRIA_SHARED_EXTRAS },
  },
  "FIBO-lite": {
    ratios: BRIA_ASPECT_RATIOS,
    tiers: [],
    extras: BRIA_SHARED_EXTRAS,
  },
} as const satisfies ModelParamTable;
