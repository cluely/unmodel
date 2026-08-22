/**
 * The image adapter's **data**: the model list, the per-model narrowing table,
 * and the format spec where the category has one.
 *
 * A leaf rather than a section of the adapter beside it, because
 * `unmodel/krea/values` publishes these arrays for client-side pickers and the
 * adapter imports this provider's validator, its zod schema and the compile
 * helpers in `core/unified/derive`. The adapter reads the very same objects, so
 * what is published and what is sent cannot drift.
 */

import { EXTRA } from "../../core/unified/derive";
import type { ModelParamTable } from "../../core/unified/vocabulary/image";
import type {
  KreaCreativity,
  KreaImageStyleReference,
  KreaMoodboardRef,
  KreaStyleRef,
} from "./image";
import { KREA_ASPECT_RATIOS } from "./constraints";

/**
 * The three Krea 2 variants — the whole of `./models.ts`. They share one
 * request schema byte-for-byte; only the price differs.
 *
 * Krea also proxies ~50 third-party models on sibling routes
 * (`/generate/image/{vendor}/{model}`), each with its own per-vendor request
 * schema. Those belong to their own providers, so a ref naming one warns as
 * `unknown_model` here.
 */
export const MODELS = ["krea-2/medium", "krea-2/large", "krea-2/medium-turbo"] as const;

/**
 * One row, three times: the K2 variants share a request schema byte for byte.
 *
 * No `sizes` — `/generate/image/krea/krea-2` has no pixel field, only
 * `aspect_ratio` and a single-valued `resolution` — so `size` types as `never`
 * and `tiers` is the one tier `KREA_RESOLUTIONS` contains.
 *
 * The seven extras are K2's generative sliders and reference inputs, typed
 * from `./image.ts`'s own interfaces so the shape an editor offers and the
 * shape `generateImage` checks are one declaration.
 */
export const KREA_ROW = {
  ratios: KREA_ASPECT_RATIOS,
  tiers: ["1k"],
  extras: {
    creativity: EXTRA as KreaCreativity,
    intensity: EXTRA as number,
    complexity: EXTRA as number,
    movement: EXTRA as number,
    styles: EXTRA as KreaStyleRef[],
    image_style_references: EXTRA as KreaImageStyleReference[],
    moodboards: EXTRA as KreaMoodboardRef[],
  },
} as const;

export const KREA_IMAGE_MODEL_PARAMS = {
  "krea-2/medium": KREA_ROW,
  "krea-2/large": KREA_ROW,
  "krea-2/medium-turbo": KREA_ROW,
} as const satisfies ModelParamTable;
